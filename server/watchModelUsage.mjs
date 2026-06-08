/**
 * Youmi Watch — model-usage ledger wiring (Phase 5B).
 *
 * Turns a CONFIRMED DashScope/Qwen chat response's token usage into internal
 * cost-ledger events (public.watch_cost_events) via the shared best-effort
 * recordWatchCostEvent helper.
 *
 * DESIGN CONTRACT
 *   • Best-effort: never throws, never blocks the AI pipeline. A failed write is
 *     logged (concise warning) and dropped.
 *   • Records NOTHING unless real token counts are present — we never guess
 *     usage. Missing/zero counts → no event.
 *   • DashScope only: an OpenAI fallback (different provider) is never recorded
 *     here, so a row is never mislabeled `dashscope`.
 *   • Input and output tokens are recorded as SEPARATE events (tokens_in /
 *     tokens_out) so each is priced at its own rate in watchPricing (input and
 *     output rates differ; a combined event would over-charge input tokens).
 *   • Metadata holds only small non-secret descriptors — never prompts,
 *     transcript/summary text, model output, keys, headers, tokens, or raw
 *     provider responses.
 */
import { recordWatchCostEvent } from './watchLedger.mjs'

/** Coerce to a positive integer token count, or 0 when absent/invalid. */
function tokenCount(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

/**
 * Record DashScope/Qwen chat token usage as up to two internal ledger events.
 *
 * @param {{
 *   usage?: { provider?: string, model?: string, prompt_tokens?: number, completion_tokens?: number } | null,
 *   userId?: string|null, recordingId?: string|null,
 *   eventType?: string, feature?: string
 * }} input
 * @returns {Promise<{ recorded: number, reason?: string }>}
 */
export async function recordDashscopeChatUsage({
  usage,
  userId,
  recordingId,
  eventType = 'summary',
  feature = 'after_class_summary',
} = {}) {
  try {
    if (!usage || typeof usage !== 'object') return { recorded: 0, reason: 'no_usage' }
    // DashScope only — never record an OpenAI (or other) fallback as dashscope.
    if (usage.provider && usage.provider !== 'dashscope') {
      return { recorded: 0, reason: 'not_dashscope' }
    }
    const inTok = tokenCount(usage.prompt_tokens)
    const outTok = tokenCount(usage.completion_tokens)
    if (inTok === 0 && outTok === 0) return { recorded: 0, reason: 'no_token_counts' }

    const model = typeof usage.model === 'string' && usage.model ? usage.model.slice(0, 64) : null
    const base = {
      provider: 'dashscope',
      event_type: eventType,
      source: 'internal',
      status: 'recorded',
      user_id: userId ?? null,
      recording_id: recordingId ?? null,
    }
    // NB: key names avoid the watchLedger sensitive-key filter (no "token",
    // "prompt", "content", etc.) so these descriptors survive scrubbing.
    const meta = (direction) => ({
      model,
      request_type: eventType,
      feature,
      direction,
      has_usage: true,
    })

    const writes = []
    if (inTok > 0) {
      writes.push(
        recordWatchCostEvent({ ...base, quantity: inTok, unit: 'tokens_in', metadata: meta('input') }),
      )
    }
    if (outTok > 0) {
      writes.push(
        recordWatchCostEvent({ ...base, quantity: outTok, unit: 'tokens_out', metadata: meta('output') }),
      )
    }

    const results = await Promise.all(writes)
    const recorded = results.filter((r) => r?.ok).length
    if (recorded < results.length) {
      console.warn(
        `[watchModelUsage] dashscope ${eventType} usage: ${recorded}/${results.length} events recorded`,
      )
    }
    return { recorded }
  } catch (err) {
    // Defensive: recordWatchCostEvent is best-effort, but never let a ledger
    // problem affect the AI pipeline / response.
    console.warn(`[watchModelUsage] dashscope usage record threw: ${err?.message || 'unknown'}`)
    return { recorded: 0, reason: 'threw' }
  }
}
