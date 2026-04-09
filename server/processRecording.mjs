import { createClient } from '@supabase/supabase-js'
import * as youmiHosted from './ai/hosted/youmiHosted.mjs'
import { CLIENT_SAFE_UNAVAILABLE } from './ai/errors.mjs'

const BUCKET = 'lecture-audio'

const processingIds = new Set()

/**
 * User-scoped client (JWT) for auth + Storage (RLS). Optional service-role client for `recordings` writes
 * so POST /api/process-recording can persist ai_status / transcript after ownership is verified.
 * Never use service role without `.eq('user_id', userId)` on recordings.
 */
function createSupabaseClients(supabaseUrl, anonKey, jwt) {
  const userSb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const dbSb = serviceRole
    ? createClient(supabaseUrl, serviceRole, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : userSb
  return { userSb, dbSb, usingServiceRoleForRecordings: Boolean(serviceRole) }
}

function logPostgrestError(scope, err) {
  if (!err) return
  console.error(
    `[process-recording] ${scope}`,
    JSON.stringify(
      {
        message: err.message,
        code: err.code,
        details: err.details,
        hint: err.hint,
      },
      null,
      2,
    ),
  )
}

/**
 * POST /api/process-recording
 * Body: { recordingId: string }
 * Header: Authorization: Bearer <Supabase user JWT>
 */
export async function handleProcessRecording(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  const caps = youmiHosted.hostedCapabilities()

  if (!supabaseUrl || !anonKey || !caps.transcribe || !caps.summarize) {
    res.status(503).json({ error: CLIENT_SAFE_UNAVAILABLE })
    return
  }

  const authHeader = req.headers.authorization
  const jwt = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!jwt) {
    res.status(401).json({ error: 'Sign in again to continue.' })
    return
  }

  const recordingId = req.body?.recordingId
  if (!recordingId || typeof recordingId !== 'string') {
    res.status(400).json({ error: 'Invalid request' })
    return
  }

  if (processingIds.has(recordingId)) {
    res.status(202).json({ ok: true, deduped: true })
    return
  }

  const { userSb, dbSb, usingServiceRoleForRecordings } = createSupabaseClients(supabaseUrl, anonKey, jwt)

  const { data: userData, error: userErr } = await userSb.auth.getUser()
  const userId = userData.user?.id
  if (userErr || !userId) {
    res.status(401).json({ error: 'Sign in again to continue.' })
    return
  }

  const { data: row, error: rowErr } = await userSb
    .from('recordings')
    .select('id')
    .eq('id', recordingId)
    .eq('user_id', userId)
    .maybeSingle()

  if (rowErr || !row) {
    if (rowErr) logPostgrestError('enqueue select recording', rowErr)
    res.status(404).json({ error: 'Recording not found.' })
    return
  }

  processingIds.add(recordingId)

  console.warn(
    '[process-recording] enqueue',
    JSON.stringify({ recordingId, userIdPrefix: userId.slice(0, 8), t: new Date().toISOString() }),
  )

  const now = new Date().toISOString()
  /** Step: enqueue job — UPDATE ai_status -> queued (fails here => client sees "Could not update recording.") */
  const { error: upErr } = await dbSb
    .from('recordings')
    .update({
      ai_status: 'queued',
      ai_error: null,
      ai_updated_at: now,
    })
    .eq('id', recordingId)
    .eq('user_id', userId)

  if (upErr) {
    logPostgrestError('enqueue update ai_status=queued', upErr)
    processingIds.delete(recordingId)
    res.status(500).json({
      error: 'Could not update recording.',
      step: 'enqueue_ai_status_queued',
      supabaseError: {
        message: upErr.message,
        code: upErr.code,
        details: upErr.details,
        hint: upErr.hint,
      },
      usingServiceRoleForRecordings,
    })
    return
  }

  res.status(202).json({ ok: true, recordingId, usingServiceRoleForRecordings })

  setImmediate(() => {
    runJob({ userSb, dbSb, userId, recordingId, usingServiceRoleForRecordings }).finally(() => {
      processingIds.delete(recordingId)
    })
  })
}

function jobLog(phase, payload) {
  console.warn(
    `[process-recording] ${phase}`,
    JSON.stringify({ ...payload, t: new Date().toISOString() }),
  )
}

async function runJob({ userSb, dbSb, userId, recordingId, usingServiceRoleForRecordings }) {
  const markFailed = async (msg) => {
    jobLog('mark_failed', { recordingId, userId: userId.slice(0, 8), message: msg })
    const { error } = await dbSb
      .from('recordings')
      .update({
        ai_status: 'failed',
        ai_error: msg,
        ai_updated_at: new Date().toISOString(),
      })
      .eq('id', recordingId)
      .eq('user_id', userId)
    if (error) logPostgrestError('markFailed', error)
  }

  jobLog('job_start', {
    recordingId,
    userIdPrefix: userId.slice(0, 8),
    usingServiceRoleForRecordings,
  })

  try {
    /** Prefer service-role reads when available: avoids RLS/JWT edge cases that return 0 rows for user client. */
    const metaClient = usingServiceRoleForRecordings ? dbSb : userSb
    const { data: row, error: metaErr } = await metaClient
      .from('recordings')
      .select('storage_path,course,title')
      .eq('id', recordingId)
      .eq('user_id', userId)
      .maybeSingle()

    if (metaErr || !row) {
      if (metaErr) logPostgrestError('runJob select meta', metaErr)
      jobLog('meta_missing', {
        recordingId,
        metaErr: metaErr ? metaErr.message : null,
        usedClient: usingServiceRoleForRecordings ? 'service_role' : 'user_jwt',
      })
      await markFailed('Recording could not be loaded.')
      return
    }

    jobLog('meta_ok', {
      recordingId,
      storagePathTail: row.storage_path?.includes('/')
        ? row.storage_path.slice(row.storage_path.lastIndexOf('/') + 1)
        : row.storage_path,
      usedClient: usingServiceRoleForRecordings ? 'service_role' : 'user_jwt',
    })

    if (!row.storage_path || !row.storage_path.startsWith(`${userId}/`)) {
      await markFailed('Invalid storage path for this recording.')
      return
    }

    const { error: stErr } = await dbSb
      .from('recordings')
      .update({
        ai_status: 'transcribing',
        ai_updated_at: new Date().toISOString(),
      })
      .eq('id', recordingId)
      .eq('user_id', userId)
    if (stErr) {
      logPostgrestError('runJob update transcribing', stErr)
      await markFailed('Could not update recording status.')
      return
    }

    jobLog('status_transcribing', { recordingId })

    const signedTtlSec = Number(process.env.YUMI_STORAGE_SIGNED_URL_SEC || 7200)
    const { data: signed, error: signErr } = await userSb.storage
      .from(BUCKET)
      .createSignedUrl(row.storage_path, signedTtlSec)

    if (signErr || !signed?.signedUrl) {
      logPostgrestError('runJob storage signed url', signErr)
      jobLog('signed_url_failed', { recordingId, signErr: signErr?.message ?? 'no url' })
      await markFailed('Could not prepare audio for processing.')
      return
    }

    const pathTail = row.storage_path.includes('/')
      ? row.storage_path.slice(row.storage_path.lastIndexOf('/') + 1)
      : row.storage_path
    try {
      const headRes = await fetch(signed.signedUrl, { method: 'HEAD' })
      const cl = headRes.headers.get('content-length')
      const ct = headRes.headers.get('content-type')
      jobLog('audio_head', {
        recordingId,
        storageObjectTail: pathTail,
        headStatus: headRes.status,
        contentLength: cl ?? 'absent',
        contentType: ct ?? 'absent',
      })
    } catch (hErr) {
      jobLog('audio_head_failed', {
        recordingId,
        storageObjectTail: pathTail,
        message: String(hErr),
      })
    }

    let transcript
    try {
      jobLog('transcribe_begin', { recordingId })
      transcript = await youmiHosted.transcribeAudioFromUrl(signed.signedUrl)
      jobLog('transcribe_done', { recordingId, textLen: transcript?.length ?? 0 })
    } catch (e) {
      console.warn('[process-recording] transcribe', e)
      jobLog('transcribe_error', { recordingId, message: e instanceof Error ? e.message : String(e) })
      await markFailed('Transcription did not finish. Try again in a moment.')
      return
    }

    const { error: txErr } = await dbSb
      .from('recordings')
      .update({
        transcript,
        ai_status: 'summarizing',
        ai_updated_at: new Date().toISOString(),
      })
      .eq('id', recordingId)
      .eq('user_id', userId)
    if (txErr) {
      logPostgrestError('runJob update transcript+summarizing', txErr)
      await markFailed('Could not save transcript after transcription.')
      return
    }

    jobLog('status_summarizing', { recordingId, transcriptLen: transcript.length })

    let summaryEn
    let summaryZh
    try {
      jobLog('summarize_begin', { recordingId })
      const s = await youmiHosted.summarizeTranscript(transcript, row.course, row.title)
      summaryEn = s.summaryEn
      summaryZh = s.summaryZh
      jobLog('summarize_done', {
        recordingId,
        summaryEnLen: summaryEn?.length ?? 0,
        summaryZhLen: summaryZh?.length ?? 0,
      })
    } catch (e) {
      console.warn('[process-recording] summarize', e)
      jobLog('summarize_error', { recordingId, message: e instanceof Error ? e.message : String(e) })
      const { error: sumFailErr } = await dbSb
        .from('recordings')
        .update({
          transcript,
          ai_status: 'failed',
          ai_error:
            'Summaries did not finish. Your transcript was saved - you can try again shortly.',
          ai_updated_at: new Date().toISOString(),
        })
        .eq('id', recordingId)
        .eq('user_id', userId)
      if (sumFailErr) logPostgrestError('runJob summarize fail persist', sumFailErr)
      return
    }

    const { error: doneErr } = await dbSb
      .from('recordings')
      .update({
        transcript,
        summary_en: summaryEn,
        summary_zh: summaryZh,
        ai_status: 'done',
        ai_error: null,
        ai_updated_at: new Date().toISOString(),
      })
      .eq('id', recordingId)
      .eq('user_id', userId)
    if (doneErr) {
      logPostgrestError('runJob final done', doneErr)
      await markFailed('Could not save summaries after processing.')
    } else {
      jobLog('job_done', { recordingId })
    }
  } catch (e) {
    console.warn('[process-recording] job', e)
    jobLog('job_throw', { recordingId, message: e instanceof Error ? e.message : String(e) })
    await markFailed('Something went wrong while processing this lecture.')
  }
}
