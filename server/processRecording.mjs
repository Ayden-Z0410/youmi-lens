import { createClient } from '@supabase/supabase-js'
import * as youmiHosted from './ai/hosted/youmiHosted.mjs'
import { CLIENT_SAFE_UNAVAILABLE } from './ai/errors.mjs'
import { recordDashscopeChatUsage } from './watchModelUsage.mjs'
import {
  canonicalizeLectureTranscript,
  transcriptCanonicalQualityGate,
} from '../src/lib/transcriptCanonicalCore.js'
import {
  getEffectiveQuota,
  checkProcessingAllowed,
  recordBetaUsage,
  BETA_ERROR_CODES,
} from './betaGate.mjs'
import { qwenLanguageFor, resolveContentLanguagePair, shouldTranslate, legacySummaryMirror } from './contentLanguages.mjs'

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

const TRANSCRIPT_TRANSLATE_CHUNK_CHARS = 1600

/**
 * Split a transcript into translation-sized chunks, preferring paragraph then
 * sentence boundaries, so each LLM translation call stays well within model
 * input/output limits. A pathologically long sentence is hard-sliced.
 */
function chunkTranscriptForTranslation(text, maxChars = TRANSCRIPT_TRANSLATE_CHUNK_CHARS) {
  const clean = String(text ?? '').trim()
  if (!clean) return []
  if (clean.length <= maxChars) return [clean]

  const chunks = []
  let buf = ''
  const flush = () => {
    const trimmed = buf.trim()
    if (trimmed) chunks.push(trimmed)
    buf = ''
  }
  const pushPiece = (piece, joiner) => {
    if (!piece) return
    if (buf && buf.length + joiner.length + piece.length > maxChars) flush()
    buf = buf ? `${buf}${joiner}${piece}` : piece
  }

  for (const paragraph of clean.split(/\n{2,}/)) {
    const para = paragraph.trim()
    if (!para) continue
    if (para.length <= maxChars) {
      pushPiece(para, '\n\n')
      continue
    }
    flush()
    for (const sentence of para.split(/(?<=[.!?。！？])\s+/)) {
      const s = sentence.trim()
      if (!s) continue
      if (s.length <= maxChars) {
        pushPiece(s, ' ')
        continue
      }
      flush()
      for (let i = 0; i < s.length; i += maxChars) chunks.push(s.slice(i, i + maxChars))
    }
    flush()
  }
  flush()
  return chunks
}

/**
 * Translate an English transcript to Chinese, chunk by chunk, via the existing
 * hosted translation helper (the same one used for live-caption translation).
 * Throws if any chunk fails — the caller treats translation as best-effort and
 * never fails the job over it.
 */
async function translateTranscript(transcript, sourceLanguage, translationLanguage) {
  const chunks = chunkTranscriptForTranslation(transcript)
  if (chunks.length === 0) return ''
  const source = qwenLanguageFor(sourceLanguage)
  const target = qwenLanguageFor(translationLanguage)
  const out = []
  for (let i = 0; i < chunks.length; i += 1) {
    const translated = await youmiHosted.translateText(chunks[i], target.name, source.name)
    out.push(typeof translated === 'string' ? translated.trim() : '')
  }
  return out.join('\n\n').trim()
}

/**
 * Best-effort write of the Chinese transcript. Never fails the job: a missing
 * transcript_zh column (supabase-migration-transcript-zh.sql not yet applied)
 * or any write error is logged and swallowed so the English transcript and
 * summaries are unaffected.
 */
async function persistTranslatedTranscript(dbSb, recordingId, userId, translated, translationLanguage) {
  const patch = { translated_transcript: translated }
  if (translationLanguage === 'zh-Hans') patch.transcript_zh = translated
  const { error } = await dbSb.from('recordings').update(patch).eq('id', recordingId).eq('user_id', userId)
  if (error) throw error
}

/**
 * Best-effort write of the generic multilingual summary fields
 * (source_summary / translated_summary). Never fails the job: a missing column
 * (migration supabase-migration-generic-summaries.sql not yet applied) or any
 * write error is logged and swallowed, since the language-based legacy mirror
 * (summary_en / summary_zh) has already been written in the done payload.
 * `translated_summary` is null when source === target.
 */
async function persistGenericSummaries(dbSb, recordingId, userId, sourceSummary, translatedSummary) {
  const patch = { source_summary: sourceSummary, translated_summary: translatedSummary ?? null }
  const { error } = await dbSb.from('recordings').update(patch).eq('id', recordingId).eq('user_id', userId)
  if (error) {
    console.warn(
      '[process-recording] generic summary persist skipped',
      JSON.stringify({ recordingId, message: error.message }),
    )
  }
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
    .select('id,duration_sec,ai_status')
    .eq('id', recordingId)
    .eq('user_id', userId)
    .maybeSingle()

  if (rowErr || !row) {
    if (rowErr) logPostgrestError('enqueue select recording', rowErr)
    res.status(404).json({ error: 'Recording not found.' })
    return
  }

  // ── Beta gate ─────────────────────────────────────────────────────────────
  // Determine if this is a first-time process or a regeneration.
  // Both consume quota; action_type distinguishes them in beta_usage.
  const isRegeneration = row.ai_status === 'done' || row.ai_status === 'transcript_ready'
  const betaActionType = isRegeneration ? 'regenerate_summary' : 'process_recording'
  const durationSec = Number(row.duration_sec) || 0
  const email = userData.user?.email || ''

  const quota = await getEffectiveQuota(userId, email)
  const gate = await checkProcessingAllowed(quota, userId, durationSec)
  if (!gate.allowed) {
    console.warn(
      '[process-recording] beta_gate_blocked',
      JSON.stringify({
        userId: userId.slice(0, 8),
        recordingId,
        durationSec,
        actionType: betaActionType,
        code: gate.body.error,
      }),
    )
    res.status(gate.status).json(gate.body)
    return
  }
  // ─────────────────────────────────────────────────────────────────────────

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
    runJob({
      userSb,
      dbSb,
      userId,
      email,
      recordingId,
      durationSec,
      betaActionType,
      usingServiceRoleForRecordings,
    }).finally(() => {
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

async function runJob({ userSb, dbSb, userId, email, recordingId, durationSec, betaActionType, usingServiceRoleForRecordings }) {
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
      .select('storage_path,course,title,source_language,translation_language')
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
    const { sourceLanguage, translationLanguage } = resolveContentLanguagePair({
      sourceLanguage: row.source_language,
      translationLanguage: row.translation_language,
    })

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

    // Record beta usage now that we are committed to consuming AI resources.
    // Fires for both first-time processing and regeneration.
    void recordBetaUsage(userId, email || '', recordingId, betaActionType || 'process_recording', durationSec || 0)

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
      transcriptRaw = await youmiHosted.transcribeAudioFromUrl(signed.signedUrl, [qwenLanguageFor(sourceLanguage).code])
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

    // Best-effort: translate the English transcript to Chinese for bilingual
    // study support. A failure here must never fail the job — the English
    // transcript is already persisted and the summaries stand on their own.
    const canTranslate = youmiHosted.hostedCapabilities().translate
    if (canTranslate && shouldTranslate(sourceLanguage, translationLanguage)) {
      try {
        jobLog('transcript_translate_begin', {
          recordingId,
          transcriptLen: transcriptCanonical.length,
        })
        const translatedTranscript = await translateTranscript(transcriptCanonical, sourceLanguage, translationLanguage)
        if (translatedTranscript) {
          await persistTranslatedTranscript(dbSb, recordingId, userId, translatedTranscript, translationLanguage)
          jobLog('transcript_translate_done', { recordingId, translatedTranscriptLen: translatedTranscript.length, translationLanguage })
        } else {
          jobLog('transcript_translate_empty', { recordingId })
        }
      } catch (e) {
        // Logged and swallowed — the Chinese transcript is optional study support.
        console.warn('[process-recording] transcript_translate', e)
        jobLog('transcript_translate_error', {
          recordingId,
          message: e instanceof Error ? e.message : String(e),
        })
      }
    } else {
      jobLog('transcript_translate_skipped', { recordingId, reason: canTranslate ? 'source_equals_target' : 'translate_unconfigured' })
    }

    const canSummarize = youmiHosted.hostedCapabilities().summarize
    if (!canSummarize) {
      jobLog('job_done_no_summarize', { recordingId })
      v1PipelineLog('job_partial', { recordingId, reason: 'summarize_unconfigured' })
      return
    }

    let sourceSummary
    let translatedSummary
    const summarizeWallT0 = Date.now()
    try {
      jobLog('summarize_begin', { recordingId })
      const s = await youmiHosted.summarizeTranscript(transcriptCanonical, row.course, row.title, {
        sourceLanguage,
        translationLanguage,
      })
      sourceSummary = s.sourceSummary
      translatedSummary = s.translatedSummary
      // Best-effort: record DashScope/Qwen token usage for this successful
      // summary as internal cost-ledger events (Phase 5B). Fire-and-forget —
      // never blocks or fails the job; records nothing if usage is absent.
      void recordDashscopeChatUsage({
        usage: s.usage,
        userId,
        recordingId,
        eventType: 'summary',
        feature: 'after_class_summary',
      })
      jobLog('summarize_done', {
        recordingId,
        sourceSummaryLen: sourceSummary?.length ?? 0,
        translatedSummaryLen: translatedSummary?.length ?? 0,
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

    const translationRequired = shouldTranslate(sourceLanguage, translationLanguage)
    const summaryOk = Boolean(sourceSummary?.trim() && (!translationRequired || translatedSummary?.trim()))
    /**
     * Summary success path: write ONLY core columns present on every greenfield schema.
     * Do not repeat transcript/transcript_raw here — already persisted; re-including them can fail
     * on older DBs or widen failure surface. V1 flags/timing follow in tryOptionalV1PipelineExtras.
     */
    // Legacy language-specific mirror: each legacy column holds the summary
    // version in THAT language, whether it is the source or the translated one.
    // Non-English/non-Chinese summaries are never written into these columns.
    const { summary_en, summary_zh } = legacySummaryMirror(
      sourceLanguage,
      translationLanguage,
      sourceSummary,
      translatedSummary,
    )
    const doneCorePayload = {
      summary_en,
      summary_zh,
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
      // Generic multilingual summary fields (authoritative for the UI). Best-effort:
      // the legacy summary_en/summary_zh mirror above already landed in the done payload.
      await persistGenericSummaries(dbSb, recordingId, userId, sourceSummary, translatedSummary)
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
