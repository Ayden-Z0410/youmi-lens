/**
 * Sentence-aware buffering for LIVE (streaming) transcript translation.
 *
 * Deepgram emits many short FINAL segments. Translating each one on its own
 * splits a single spoken sentence into disconnected Chinese fragments — e.g.
 * "I have something" then "that I want to show you today." become two unrelated
 * translations. These PURE helpers let the WebSocket relay accumulate
 * consecutive finals into a coherent phrase and translate it as ONE unit.
 *
 * English (`stream_final`) is still relayed per-segment so the live transcript
 * stays responsive; only the Chinese translation is buffered. The relay owns the
 * debounce-pause and stream-stop flushes (timers/I/O); everything here is pure
 * and directly unit-testable.
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
 * Stateful lifecycle wrapper used by the WebSocket relay. It keeps timers out of
 * the pure segmentation helpers while making stop/restart teardown flushable and
 * idempotent.
 */
export function createFinalTranslationBuffer({
  enqueue,
  isEnabled = () => true,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  debounceMs = FINAL_BUFFER_DEBOUNCE_MS,
} = {}) {
  if (typeof enqueue !== 'function') {
    throw new TypeError('createFinalTranslationBuffer requires an enqueue function')
  }

  let buffer = ''
  let lastId = null
  let timer = null

  const cancelTimer = () => {
    if (timer) {
      clearTimer(timer)
      timer = null
    }
  }

  const reset = () => {
    buffer = ''
    lastId = null
  }

  const flush = () => {
    cancelTimer()
    const text = buffer.trim()
    const id = lastId
    reset()
    if (!id || !text) return false
    if (!isEnabled()) return false
    enqueue(id, text)
    return true
  }

  const clear = () => {
    cancelTimer()
    reset()
  }

  const appendFinal = (id, text) => {
    if (!isEnabled()) {
      clear()
      return 'skipped'
    }
    const trimmed = typeof text === 'string' ? text.trim() : ''
    if (!id || !trimmed) return 'skipped'

    buffer = appendSegment(buffer, trimmed)
    lastId = id

    if (shouldFlushBuffer(buffer) === 'flush') {
      return flush() ? 'flushed' : 'skipped'
    }

    cancelTimer()
    timer = setTimer(flush, debounceMs)
    return 'buffered'
  }

  return {
    appendFinal,
    flush,
    clear,
    hasPending: () => Boolean(buffer.trim()),
  }
}
