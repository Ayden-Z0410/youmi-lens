import { getAiApiBase } from './aiClient'

/**
 * Ask the platform server to transcribe + summarize a cloud recording using server-side credentials.
 * Server updates `recordings` (ai_status, transcript, summaries). Client should poll until `done` / `failed`.
 */
type ProcessRecordingErrBody = {
  error?: string
  step?: string
  supabaseError?: { message?: string; code?: string; details?: string; hint?: string }
  usingServiceRoleForRecordings?: boolean
}

export async function requestHostedRecordingAi(opts: {
  accessToken: string
  recordingId: string
}): Promise<{ ok: true } | { ok: false; message: string; debug?: ProcessRecordingErrBody }> {
  const res = await fetch(`${getAiApiBase()}/process-recording`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.accessToken}`,
    },
    body: JSON.stringify({ recordingId: opts.recordingId }),
  })

  if (res.status === 202 || res.status === 200) {
    return { ok: true }
  }

  let message = 'Youmi AI could not be started. Try again in a moment.'
  let debug: ProcessRecordingErrBody | undefined
  try {
    const j = (await res.json()) as ProcessRecordingErrBody
    debug = j
    if (j.error && typeof j.error === 'string' && j.error.length < 200) {
      message = j.error
    }
    const se = j.supabaseError
    if (se?.message) {
      message = `${message} [${se.code ?? 'no-code'}] ${se.message}${se.details ? ` — ${se.details}` : ''}`
    }
    if (j.step) {
      message = `${message} (step: ${j.step})`
    }
  } catch {
    /* use default */
  }
  return { ok: false, message, debug }
}
