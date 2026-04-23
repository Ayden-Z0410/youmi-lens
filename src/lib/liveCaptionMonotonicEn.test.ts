import { describe, expect, it } from 'vitest'
import {
  initialEnInterimStabilizeState,
  stabilizeEnInterimSnapshot,
} from './liveCaptionMonotonicEn'

function apply(
  state: ReturnType<typeof initialEnInterimStabilizeState>,
  ...snapshots: string[]
) {
  let s = state
  let text = ''
  for (const snap of snapshots) {
    const r = stabilizeEnInterimSnapshot(s, snap)
    s = r.state
    text = r.text
  }
  return { text, state: s }
}

describe('stabilizeEnInterimSnapshot', () => {
  it('first frame shows raw', () => {
    const r = apply(initialEnInterimStabilizeState(), 'Hello world')
    expect(r.text).toBe('Hello world')
  })

  it('extends monotonically on pure append', () => {
    const r = apply(
      initialEnInterimStabilizeState(),
      'Hello world',
      'Hello world today',
      'Hello world today is great',
    )
    expect(r.text).toBe('Hello world today is great')
  })

  it('keeps locked when snapshot shrinks without new words', () => {
    const r = apply(
      initialEnInterimStabilizeState(),
      'One two three four five six seven',
      'One two three',
    )
    expect(r.text).toBe('One two three four five six seven')
  })

  it('strips re-expanded prefix wall (core bug)', () => {
    const intro = 'in an archaeology class a popular misconception about archaeology'
    const body = 'Some people imagine we just go out into the field with a shovel and start digging'
    const ext = 'hoping to find something significant'
    const r = apply(
      initialEnInterimStabilizeState(),
      `${intro} ${body}`,
      // ASR re-expansion: repeats intro+body then adds ext
      `${intro} ${body} ${intro} ${body} ${ext}`,
    )
    expect(r.text).toBe(`${intro} ${body} ${ext}`)
  })

  it('strips triple re-expansion', () => {
    const a = 'the quick brown fox jumps over the lazy dog'
    const r = apply(
      initialEnInterimStabilizeState(),
      a,
      // triple expansion: old + old + old + new tail
      `${a} ${a} ${a} near the river`,
    )
    expect(r.text).toBe(`${a} near the river`)
  })

  it('handles gradual re-expansion across multiple steps', () => {
    const a = 'Listen to part of a lecture in archaeology'
    const b = 'a popular misconception about archaeology'
    const c = 'some people imagine digging'
    const r = apply(
      initialEnInterimStabilizeState(),
      `${a} ${b}`,
      // step 2: re-expand from beginning, add c
      `${a} ${b} ${a} ${b} ${c}`,
      // step 3: re-expand again, add more
      `${a} ${b} ${c} ${a} ${b} ${c} with shovels`,
    )
    expect(r.text).toBe(`${a} ${b} ${c} with shovels`)
  })

  it('is idempotent on same snapshot', () => {
    const r = apply(
      initialEnInterimStabilizeState(),
      'Alpha beta gamma delta',
      'Alpha beta gamma delta',
      'Alpha beta gamma delta',
    )
    expect(r.text).toBe('Alpha beta gamma delta')
  })
})
