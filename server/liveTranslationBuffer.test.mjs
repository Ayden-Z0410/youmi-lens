import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  appendSegment,
  endsSentence,
  endsWithConnector,
  shouldFlushBuffer,
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

function readRelaySource() {
  return readFileSync(new URL('./liveRealtimeWs.mjs', import.meta.url), 'utf8')
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

  it('wires stream_stop to flush trailing server-owned translations immediately', () => {
    const source = readRelaySource()
    const stopStart = source.indexOf("if (msg?.type === 'stream_stop')")
    const legacyStart = source.indexOf('// ── Legacy JSON transcribe', stopStart)
    const stopBlock = source.slice(stopStart, legacyStart)

    expect(source).toContain('ws._youmiFlushTranslationBuffer = () => {')
    expect(source).toContain('finalTranslationStopRequested || shouldFlushBuffer(pendingFinalBuffer)')
    expect(stopBlock).toContain('ws._youmiFlushTranslationBuffer()')
    expect(stopBlock.indexOf('ws._youmiFlushTranslationBuffer()')).toBeLessThan(
      stopBlock.indexOf('streamingSession?.stop()'),
    )
  })
})
