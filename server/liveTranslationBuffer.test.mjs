import { describe, expect, it } from 'vitest'
import {
  appendSegment,
  createFinalTranslationBuffer,
  endsSentence,
  endsWithConnector,
  shouldFlushBuffer,
  FINAL_BUFFER_DEBOUNCE_MS,
  FINAL_BUFFER_MAX_CHARS,
} from './liveTranslationBuffer.mjs'

// Simulate the relay: feed final chunks, flush when shouldFlushBuffer says so,
// and (as the debounce/stop flush would) emit any trailing buffer at the end.
// Returns the list of English units that would each become ONE translation.
function simulate(chunks, opts) {
  let buffer = ''
  const units = []
  for (const chunk of chunks) {
    buffer = appendSegment(buffer, chunk)
    if (shouldFlushBuffer(buffer, opts) === 'flush') {
      units.push(buffer.trim())
      buffer = ''
    }
  }
  if (buffer.trim()) units.push(buffer.trim())
  return units
}

describe('liveTranslationBuffer segmentation', () => {
  it('A. combines a fragmented clause into one translation unit', () => {
    expect(simulate(['I have something', 'that I want to show you today.'])).toEqual([
      'I have something that I want to show you today.',
    ])
  })

  it('B. combines fast continuous speech into one coherent unit', () => {
    expect(
      simulate([
        'Today we are going to talk about',
        'the relationship between demand and price',
        'and why this matters in economics.',
      ]),
    ).toEqual([
      'Today we are going to talk about the relationship between demand and price and why this matters in economics.',
    ])
  })

  it('C. keeps two punctuation-separated sentences as two units', () => {
    expect(simulate(['This is important.', 'Now look at the graph.'])).toEqual([
      'This is important.',
      'Now look at the graph.',
    ])
  })

  it('D. never translates a dangling connector alone', () => {
    expect(simulate(['because', 'the result depends on the sample size.'])).toEqual([
      'because the result depends on the sample size.',
    ])
    expect(endsWithConnector('because')).toBe(true)
    expect(shouldFlushBuffer('because')).toBe('wait')
  })

  it('E. flushes when the buffer reaches max length without punctuation', () => {
    const long = 'word '.repeat(60).trim() // ~299 chars, no punctuation
    expect(long.length).toBeGreaterThanOrEqual(FINAL_BUFFER_MAX_CHARS)
    expect(shouldFlushBuffer(long)).toBe('flush')
  })

  it('does not flush a clause left dangling on a connector', () => {
    expect(endsSentence('The price rises, but')).toBe(false)
    expect(shouldFlushBuffer('The price rises, but')).toBe('wait')
  })

  it('appendSegment single-spaces and ignores empty chunks', () => {
    expect(appendSegment('', 'hello')).toBe('hello')
    expect(appendSegment('hello', 'world')).toBe('hello world')
    expect(appendSegment('hello', '   ')).toBe('hello')
    expect(appendSegment('hello', undefined)).toBe('hello')
  })

  it('treats CJK sentence punctuation as a boundary', () => {
    expect(endsSentence('这是一个句子。')).toBe(true)
    expect(shouldFlushBuffer('这是一个句子。')).toBe('flush')
  })
})

describe('liveTranslationBuffer lifecycle', () => {
  it('flushes a trailing unpunctuated final on teardown before debounce fires', () => {
    const emitted = []
    let scheduled = null
    const buffer = createFinalTranslationBuffer({
      enqueue: (id, text) => emitted.push({ id, text }),
      setTimer: (fn, ms) => {
        scheduled = { fn, ms }
        return scheduled
      },
      clearTimer: (timer) => {
        if (scheduled === timer) scheduled = null
      },
    })

    expect(buffer.appendFinal('seg-1', 'Today we are going to talk about')).toBe('buffered')
    expect(scheduled?.ms).toBe(FINAL_BUFFER_DEBOUNCE_MS)

    expect(buffer.flush()).toBe(true)
    expect(scheduled).toBeNull()
    expect(emitted).toEqual([
      { id: 'seg-1', text: 'Today we are going to talk about' },
    ])

    expect(buffer.flush()).toBe(false)
    expect(emitted).toHaveLength(1)
  })
})
