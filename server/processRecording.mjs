import { createClient } from '@supabase/supabase-js'
import * as youmiHosted from './ai/hosted/youmiHosted.mjs'
import { CLIENT_SAFE_UNAVAILABLE } from './ai/errors.mjs'
import {
  canonicalizeLectureTranscript,
  transcriptCanonicalQualityGate,
} from '../src/lib/transcriptCanonicalCore.js'

const BUCKET = 'lecture-audio'

const processingIds = new Set()

function v1PipelineLog(event, fields) {
  console.warn(`[V1Pipeline] ${event}`, JSON.stringify({ ...fields, t: new Date().toISOString() }))
  if (process.env.YOUMI_PIPELINE_TRACE === '1') {
    console.info(JSON.stringify({ source: 'v1_pipeline', event, ...fields }))
  }
}

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

function logPostgrestError(scope, err, ctx = {}) {
  if (!err) return
  console.error(
    `[process-recording] ${scope}`,
    JSON.stringify(
      {
        table: 'recordings',
        ...ctx,
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
 * Best-effort write of v1 pipeline columns (requires supabase-migration-v1-pipeline-flags.sql).
 * Never fails the job — core transcript/summary rows must persist without these columns.
 */
async function tryOptionalV1PipelineExtras(dbSb, recordingId, userId, patch, label) {
  const keys = Object.keys(patch)
  const { error } = await dbSb
    .from('recordings')
    .update(patch)
    .eq('id', recordingId)
    .eq('user_id', userId)
  if (error) {
    console.warn(
      `[process-recording] supabase optional_column_update_failed`,
      JSON.stringify({
        label,
        recordingId,
        userIdPrefix: userId.slice(0, 8),
        patchKeys: keys,
        columnNames: keys,
        migrationHint:
          'Run supabase-migration-v1-pipeline-flags.sql for transcript_ready/summary_ready/translation_ready/ai_pipeline_timing.',
        message: error.message,
        code: error.code,
        details: error.details,
        postgrestHint: error.hint,
      }),
    )
    return false
  }
  console.warn(`[process-recording] supabase update_ok`, JSON.stringify({ label, recordingId, patchKeys: keys }))
  return true
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

  console.warn(
    '[process-recording] received',
    JSON.stringify({
      hasRecordingId: Boolean(req.body?.recordingId),
      transcribeCap: caps.transcribe,
      marker: process.env.YOUMI_DEPLOY_MARKER || null,
    }),
  )

  if (!supabaseUrl || !anonKey || !caps.transcribe) {
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
  const enqueuePayloadKeys = ['ai_status', 'ai_error', 'ai_updated_at']
  /** Step: enqueue job — UPDATE ai_status -> queued (fails here => client sees "Could not update recording.") */
  console.warn(
    '[process-recording] supabase update start',
    JSON.stringify({
      step: 'enqueue_ai_status_queued',
      recordingId,
      userIdPrefix: userId.slice(0, 8),
      table: 'recordings',
      payloadKeys: enqueuePayloadKeys,
      usingServiceRoleForRecordings,
    }),
  )
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
    console.warn('[process-recording] supabase update error', JSON.stringify({ step: 'enqueue_ai_status_queued', recordingId }))
    logPostgrestError('enqueue update ai_status=queued', upErr, {
      recordingId,
      userIdPrefix: userId.slice(0, 8),
      payloadKeys: enqueuePayloadKeys,
    })
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
  const jobT0 = Date.now()

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

    let transcriptRaw
    try {
      jobLog('transcribe_begin', { recordingId })
      transcriptRaw = await youmiHosted.transcribeAudioFromUrl(signed.signedUrl)
      jobLog('transcribe_done', { recordingId, textLen: transcriptRaw?.length ?? 0 })
    } catch (e) {
      console.warn('[process-recording] transcribe', e)
      jobLog('transcribe_error', { recordingId, message: e instanceof Error ? e.message : String(e) })
      await markFailed('Transcription did not finish. Try again in a moment.')
      return
    }

    const gate = transcriptCanonicalQualityGate(transcriptRaw)
    if (!gate.ok) {
      jobLog('canonical_quality_gate', { recordingId, reason: gate.reason ?? 'unknown' })
    }
    const { canonical: transcriptCanonical, diagnostics: canonDiag } =
      canonicalizeLectureTranscript(transcriptRaw)
    jobLog('canonical_ok', { recordingId, ...canonDiag })

    const transcriptReadyMs = Date.now() - jobT0
    v1PipelineLog('timing', {
      recordingId,
      transcript_ready_ms: transcriptReadyMs,
    })

    jobLog('transcribe_success', { recordingId, textLen: transcriptRaw?.length ?? 0 })

    /** Core columns only — works without v1 migration (no transcript_ready / ai_pipeline_timing columns). */
    const transcriptSavePayload = {
      transcript_raw: transcriptRaw,
      transcript: transcriptCanonical,
      ai_status: 'transcript_ready',
      ai_error: null,
      ai_updated_at: new Date().toISOString(),
    }
    const transcriptSaveKeys = Object.keys(transcriptSavePayload)
    console.warn(
      '[process-recording] supabase update start',
      JSON.stringify({
        step: 'persist_transcript_core',
        recordingId,
        userIdPrefix: userId.slice(0, 8),
        table: 'recordings',
        payloadKeys: transcriptSaveKeys,
        usingServiceRoleForRecordings,
      }),
    )

    let { error: txErr } = await dbSb
      .from('recordings')
      .update(transcriptSavePayload)
      .eq('id', recordingId)
      .eq('user_id', userId)
    if (txErr) {
      const msg = String(txErr.message || '')
      const looksLikeMissingColumn = /transcript_raw|column/i.test(msg)
      if (looksLikeMissingColumn) {
        jobLog('transcript_save_retry_without_transcript_raw', { recordingId, firstError: msg })
        const minimalPayload = {
          transcript: transcriptCanonical,
          ai_status: 'transcript_ready',
          ai_error: null,
          ai_updated_at: new Date().toISOString(),
        }
        const r2 = await dbSb
          .from('recordings')
          .update(minimalPayload)
          .eq('id', recordingId)
          .eq('user_id', userId)
        txErr = r2.error
        if (!txErr) {
          console.warn(
            '[process-recording] transcript_saved_minimal',
            JSON.stringify({ recordingId, note: 'transcript_raw column missing; run supabase-migration-transcript-canonical.sql' }),
          )
        }
      }
    }
    if (txErr) {
      console.warn('[process-recording] supabase update error', JSON.stringify({ step: 'persist_transcript_core', recordingId }))
      logPostgrestError('runJob update transcript (core columns)', txErr, {
        recordingId,
        userIdPrefix: userId.slice(0, 8),
        payloadKeys: transcriptSaveKeys,
      })
      await markFailed('Could not save transcript after transcription.')
      return
    }

    console.warn('[process-recording] done', JSON.stringify({ phase: 'transcript_saved_core', recordingId }))

    await tryOptionalV1PipelineExtras(
      dbSb,
      recordingId,
      userId,
      {
        transcript_ready: true,
        summary_ready: false,
        translation_ready: false,
        ai_pipeline_timing: {
          job_start_to_transcript_ready_ms: transcriptReadyMs,
        },
      },
      'after_transcript_flags',
    )

    jobLog('status_transcript_ready', {
      recordingId,
      transcript_ready_ms: transcriptReadyMs,
      transcriptLen: transcriptCanonical.length,
      transcriptRawLen: transcriptRaw.length,
    })

    const canSummarize = youmiHosted.hostedCapabilities().summarize
    if (!canSummarize) {
      jobLog('job_done_no_summarize', { recordingId })
      v1PipelineLog('job_partial', { recordingId, reason: 'summarize_unconfigured' })
      return
    }

    let summaryEn
    let summaryZh
    const summarizeWallT0 = Date.now()
    try {
      jobLog('summarize_begin', { recordingId })
      const s = await youmiHosted.summarizeTranscript(transcriptCanonical, row.course, row.title)
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
      const summarizeFailCore = {
        ai_status: 'transcript_ready',
        ai_error:
          'Summaries did not finish. Your transcript is available — you can try again shortly.',
        ai_updated_at: new Date().toISOString(),
      }
      console.warn(
        '[process-recording] supabase update start',
        JSON.stringify({
          step: 'summarize_fail_core',
          recordingId,
          payloadKeys: Object.keys(summarizeFailCore),
        }),
      )
      const { error: sumFailErr } = await dbSb
        .from('recordings')
        .update(summarizeFailCore)
        .eq('id', recordingId)
        .eq('user_id', userId)
      if (sumFailErr) {
        console.warn('[process-recording] supabase update error', JSON.stringify({ step: 'summarize_fail_core', recordingId }))
        logPostgrestError('runJob summarize fail persist (core)', sumFailErr, {
          recordingId,
          userIdPrefix: userId.slice(0, 8),
          payloadKeys: Object.keys(summarizeFailCore),
        })
      } else {
        await tryOptionalV1PipelineExtras(
          dbSb,
          recordingId,
          userId,
          {
            transcript_ready: true,
            summary_ready: false,
            translation_ready: false,
            ai_pipeline_timing: {
              job_start_to_transcript_ready_ms: transcriptReadyMs,
              summarize_failed_ms: Date.now() - jobT0,
            },
          },
          'summarize_fail_flags',
        )
      }
      v1PipelineLog('summary_failed', { recordingId, transcript_ready_ms: transcriptReadyMs })
      return
    }

    const summaryReadyMs = Date.now() - jobT0
    v1PipelineLog('timing', {
      recordingId,
      transcript_ready_ms: transcriptReadyMs,
      summary_ready_ms: summaryReadyMs,
      summarize_wall_ms: Date.now() - summarizeWallT0,
    })

    const summaryOk = Boolean(summaryEn?.trim() && summaryZh?.trim())
    /**
     * Summary success path: write ONLY core columns present on every greenfield schema.
     * Do not repeat transcript/transcript_raw here — already persisted; re-including them can fail
     * on older DBs or widen failure surface. V1 flags/timing follow in tryOptionalV1PipelineExtras.
     */
    const doneCorePayload = {
      summary_en: summaryEn,
      summary_zh: summaryZh,
      ai_status: 'done',
      ai_error: null,
      ai_updated_at: new Date().toISOString(),
    }
    const doneCoreColumns = Object.keys(doneCorePayload)
    console.warn(
      '[process-recording] supabase update start',
      JSON.stringify({
        step: 'final_done_core',
        recordingId,
        userIdPrefix: userId.slice(0, 8),
        table: 'recordings',
        payloadKeys: doneCoreColumns,
        columnsWritten: doneCoreColumns,
        usingServiceRoleForRecordings,
      }),
    )
    const { error: doneErr } = await dbSb
      .from('recordings')
      .update(doneCorePayload)
      .eq('id', recordingId)
      .eq('user_id', userId)
    if (doneErr) {
      console.warn(
        '[process-recording] supabase update error',
        JSON.stringify({
          step: 'final_done_core',
          recordingId,
          userIdPrefix: userId.slice(0, 8),
          payloadKeys: doneCoreColumns,
          columnsWritten: doneCoreColumns,
          message: doneErr.message,
          code: doneErr.code,
          details: doneErr.details,
          hint: doneErr.hint,
        }),
      )
      logPostgrestError('runJob final done (summary core only)', doneErr, {
        recordingId,
        userIdPrefix: userId.slice(0, 8),
        payloadKeys: doneCoreColumns,
        columnsWritten: doneCoreColumns,
      })
      await markFailed('Could not save summaries after processing.')
    } else {
      await tryOptionalV1PipelineExtras(
        dbSb,
        recordingId,
        userId,
        {
          transcript_ready: true,
          summary_ready: summaryOk,
          translation_ready: summaryOk,
          ai_pipeline_timing: {
            job_start_to_transcript_ready_ms: transcriptReadyMs,
            job_start_to_summary_ready_ms: summaryReadyMs,
            summarize_wall_ms: Date.now() - summarizeWallT0,
          },
        },
        'final_done_flags',
      )
      jobLog('job_done', { recordingId, summary_ready_ms: summaryReadyMs })
      console.warn('[process-recording] done', JSON.stringify({ phase: 'job_complete', recordingId }))
    }
  } catch (e) {
    console.warn('[process-recording] job', e)
    jobLog('job_throw', { recordingId, message: e instanceof Error ? e.message : String(e) })
    await markFailed('Something went wrong while processing this lecture.')
  }
}
