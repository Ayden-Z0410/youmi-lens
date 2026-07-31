/**
 * Sentence-aware buffering for LIVE (streaming) transcript translation.
 *
 * Deepgram emits many short FINAL segments. Translating each one on its own
 * splits a single spoken sentence into disconnected Chinese fragments — e.g.
 * "I have something" then "that I want to show you today." become two unrelated
 * translations. These helpers let the WebSocket relay accumulate
 * consecutive finals into a coherent phrase and translate it as ONE unit.
 *
 * English (`stream_final`) is still relayed per-segment so the live transcript
 * stays responsive; only the Chinese translation is buffered. The relay still
 * owns translation I/O; this module owns the segmentation and small buffer
 * controller so debounce and stream-stop flush behavior is directly testable.
 */

/** Buffer length (chars) that force-flushes continuous speech with no punctuation. */
export const FINAL_BUFFER_MAX_CHARS = 220

/** How long (ms) to wait after the last final before flushing an unpunctuated buffer. */
export const FINAL_BUFFER_DEBOUNCE_MS = 1000

// Sentence-ending punctuation (Latin + CJK), optionally followed by a closing
// quote/bracket. A phrase ending here is a safe translation boundary...
const SENTENCE_END = /[.!?;:…。！？；：]["'’”)\]]?\s*$/

// ...unless it ends on a dangling connector that clearly expects a continuation.
// Translating these alone yields broken Chinese, so keep buffering.
const CONNECTOR_TAIL =
  /\b(that|which|because|although|though|if|when|while|where|who|whom|whose|what|so|and|but|or|to|of|for|with|as|than|then|since|unless|whether)$/i

/** Append a new final segment to the buffer, single-spaced. Pure. */
export function appendSegment(buffer, text) {
  const next = typeof text === 'string' ? text.trim() : ''
  if (!next) return typeof buffer === 'string' ? buffer : ''
  const base = typeof buffer === 'string' ? buffer : ''
  return base ? `${base} ${next}` : next
}

/** True when the trimmed text ends on a dangling connector word. Pure. */
export function endsWithConnector(text) {
  return CONNECTOR_TAIL.test((typeof text === 'string' ? text : '').trim())
}

/** True when the text ends a sentence and is NOT left dangling on a connector. Pure. */
export function endsSentence(text) {
  const t = (typeof text === 'string' ? text : '').trim()
  return t.length > 0 && SENTENCE_END.test(t) && !CONNECTOR_TAIL.test(t)
}

/**
 * Decide whether the accumulated buffer is a coherent unit to translate now.
 * Pure — the debounce-pause and stream-stop flushes are the caller's job.
 * @returns {'flush' | 'wait'}
 */
export function shouldFlushBuffer(buffer, { maxChars = FINAL_BUFFER_MAX_CHARS } = {}) {
  const t = (typeof buffer === 'string' ? buffer : '').trim()
  if (!t) return 'wait'
  if (t.length >= maxChars) return 'flush' // continuous-speech safety valve
  if (endsSentence(t)) return 'flush' // clear sentence boundary
  return 'wait' // keep accumulating
}

/**
 * Stateful relay helper for final translations. The WebSocket layer owns the
 * actual translation I/O; this controller only tracks buffered text and timers.
 */
export function createFinalTranslationBuffer({
  isEnabled = () => true,
  enqueue,
  debounceMs = FINAL_BUFFER_DEBOUNCE_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof enqueue !== 'function') {
    throw new TypeError('createFinalTranslationBuffer requires enqueue')
  }

  let buffer = ''
  let lastId = null
  let timer = null

  const clearPendingTimer = () => {
    if (timer) {
      clearTimer(timer)
      timer = null
    }
  }

  const clear = () => {
    clearPendingTimer()
    buffer = ''
    lastId = null
  }

  const flush = () => {
    clearPendingTimer()
    const text = buffer.trim()
    const id = lastId
    buffer = ''
    lastId = null
    if (!id || !text || !isEnabled()) return { flushed: false }
    enqueue(id, text)
    return { flushed: true, id, text }
  }

  const push = (id, text) => {
    const trimmed = typeof text === 'string' ? text.trim() : ''
    if (!trimmed) return { queued: false }
    buffer = appendSegment(buffer, trimmed)
    lastId = id
    if (shouldFlushBuffer(buffer) === 'flush') {
      return { queued: true, ...flush() }
    }
    clearPendingTimer()
    timer = setTimer(flush, debounceMs)
    return { queued: true, flushed: false }
  }

  return {
    push,
    flush,
    clear,
  }
}
