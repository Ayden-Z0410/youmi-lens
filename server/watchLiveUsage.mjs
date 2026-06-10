/**
 * Youmi Watch — Deepgram live-transcription ledger wiring (Phase 5C-2).
 *
 * Turns ONE finished Deepgram live session into AT MOST ONE internal cost-ledger
 * row (public.watch_cost_events), protected twice against double-counting:
 *   1. In-process: createDeepgramLiveCostFinalizer() returns a single finalize
 *      funnel with an internal once-guard, so every session end path
 *      (stream_stop / client WS close / max-session timer / upstream drop /
 *      re-stream_start) can call it safely — only the first call attempts a
 *      ledger write.
 *   2. Durable: the write carries idempotency_key `deepgram:live:<sessionId>`,
 *      and the DB's partial unique index rejects a second row for the same
 *      logical session even across process restarts (watchLedger treats that
 *      conflict as a safe duplicate).
 *
 * DESIGN CONTRACT
 *   • Best-effort: never throws to the live-session cleanup caller. A failed
 *     ledger write logs a concise warning and is dropped.
 *   • Deepgram only: any other provider records nothing.
 *   • Records NOTHING when no audio arrived (frameCount <= 0) or the wall-clock
 *     duration is not positive — no zero-cost diagnostic rows.
 *   • Duration v1 = wall-clock minutes (duration_source 'wall_clock'); we do
 *     not parse Deepgram response metadata in this phase.
 *   • Metadata holds only small non-secret descriptors — never audio,
 *     transcript/interim/final text, raw provider responses, keys, headers,
 *     tokens, prompts, or user content.
 */
import { recordWatchCostEvent } from './watchLedger.mjs'
import { round6 } from './watchPricing.mjs'

/**
 * Record one Deepgram live-transcription session as a single ledger event.
 * Never throws; returns a small status object for logging/tests.
 *
 * @param {{
 *   provider?: string, userId?: string|null, sessionId?: string,
 *   startedAtMs?: number, endedAtMs?: number,
 *   frameCount?: number, finalCount?: number,
 *   language?: string, model?: string, closeReason?: string
 * }} input
 * @returns {Promise<{ recorded: boolean, duplicate?: boolean, id?: string, reason?: string }>}
 */
export async function recordDeepgramLiveTranscriptionUsage(input = {}) {
  try {
    const {
      provider = 'deepgram',
      userId,
      sessionId,
      startedAtMs,
      endedAtMs,
      frameCount,
      finalCount,
      language,
      model,
      closeReason,
    } = input

    // Scope guard: this writer is for the Deepgram live path only.
    if (provider !== 'deepgram') return { recorded: false, reason: 'not_deepgram' }

    const sid = typeof sessionId === 'string' ? sessionId.trim() : ''
    if (!sid) return { recorded: false, reason: 'no_session_id' }

    // No audio ever reached the session → nothing billable, no row.
    const frames = Number(frameCount)
    if (!Number.isFinite(frames) || frames <= 0) return { recorded: false, reason: 'no_audio' }

    // Wall-clock billable minutes; non-positive duration → no row (never guess).
    const start = Number(startedAtMs)
    const end = Number(endedAtMs)
    const minutes =
      Number.isFinite(start) && Number.isFinite(end) ? round6((end - start) / 1000 / 60) : 0
    if (minutes <= 0) return { recorded: false, reason: 'no_duration' }

    const result = await recordWatchCostEvent({
      provider: 'deepgram',
      event_type: 'live_transcription',
      quantity: minutes,
      unit: 'minutes',
      source: 'internal',
      status: 'recorded',
      user_id: userId ?? null,
      recording_id: null, // live captions are not tied to a saved recording
      idempotency_key: `deepgram:live:${sid}`,
      metadata: {
        session_id: sid,
        close_reason:
          typeof closeReason === 'string' && closeReason ? closeReason.slice(0, 32) : 'unknown',
        duration_source: 'wall_clock',
        chunk_count: Math.round(frames),
        language: typeof language === 'string' && language ? language.slice(0, 16) : null,
        model: typeof model === 'string' && model ? model.slice(0, 32) : null,
        has_final_transcript: Number(finalCount) > 0,
      },
    })

    if (result?.ok && result.duplicate) {
      console.warn('[watchLiveUsage] deepgram live_transcription already recorded (safe duplicate)')
      return { recorded: false, duplicate: true }
    }
    if (!result?.ok) {
      console.warn(
        `[watchLiveUsage] deepgram live_transcription ledger write failed: ${result?.error || 'unknown'}`,
      )
      return { recorded: false, reason: result?.error || 'ledger_failed' }
    }
    return { recorded: true, id: result.id }
  } catch (err) {
    // Defensive: must never break live-session cleanup.
    console.warn(`[watchLiveUsage] deepgram live usage record threw: ${err?.message || 'unknown'}`)
    return { recorded: false, reason: 'threw' }
  }
}

/**
 * Build the single finalize funnel for one Deepgram live session.
 *
 * Returns `finalizeDeepgramCost(closeReason)`: every end path calls it, the
 * internal once-guard ensures only the FIRST call attempts the (fire-and-
 * forget, never-throwing) ledger write. Frame/final counts are read lazily at
 * finalize time via the injected getters so the values reflect the session end.
 *
 * @param {{
 *   provider?: string, userId?: string|null, sessionId?: string,
 *   startedAtMs?: number, language?: string, model?: string,
 *   getFrameCount?: () => number, getFinalCount?: () => number,
 *   now?: () => number
 * }} session
 * @returns {(closeReason: string) => { attempted: boolean, done: Promise<object|null> }}
 */
export function createDeepgramLiveCostFinalizer(session = {}) {
  const { now = Date.now, getFrameCount, getFinalCount, ...fixed } = session
  let costAttempted = false
  return function finalizeDeepgramCost(closeReason) {
    if (costAttempted) return { attempted: false, done: Promise.resolve(null) }
    costAttempted = true
    const done = recordDeepgramLiveTranscriptionUsage({
      ...fixed,
      endedAtMs: now(),
      frameCount: typeof getFrameCount === 'function' ? getFrameCount() : 0,
      finalCount: typeof getFinalCount === 'function' ? getFinalCount() : 0,
      closeReason,
    })
    return { attempted: true, done }
  }
}
