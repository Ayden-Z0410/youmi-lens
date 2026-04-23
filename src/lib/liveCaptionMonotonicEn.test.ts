import { describe, expect, it } from 'vitest'
import {
  initialEnInterimStabilizeState,
  longestCommonPrefix,
  stabilizeEnInterimSnapshot,
} from './liveCaptionMonotonicEn'

describe('longestCommonPrefix', () => {
  it('returns shared prefix', () => {
    expect(longestCommonPrefix('hello world', 'hello there')).toBe('hello ')
  })
})

describe('stabilizeEnInterimSnapshot', () => {
  it('first frame shows raw', () => {
    const s0 = initialEnInterimStabilizeState()
    const r1 = stabilizeEnInterimSnapshot(s0, 'Hello world')
    expect(r1.text).toBe('Hello world')
  })

  it('extends monotonically when raw prefixes lastShown', () => {
    let st = initialEnInterimStabilizeState()
    st = stabilizeEnInterimSnapshot(st, 'Hello world').state
    const r2 = stabilizeEnInterimSnapshot(st, 'Hello world today')
    expect(r2.text).toBe('Hello world today')
  })

  it('drops no-op resend (same text)', () => {
    let st = initialEnInterimStabilizeState()
    st = stabilizeEnInterimSnapshot(st, 'Alpha beta gamma').state
    const r2 = stabilizeEnInterimSnapshot(st, 'Alpha beta gamma')
    expect(r2.text).toBe('Alpha beta gamma')
    expect(r2.state.lastShown).toBe('Alpha beta gamma')
  })

  it('rejects shrink-only resend without new words', () => {
    let st = initialEnInterimStabilizeState()
    st = stabilizeEnInterimSnapshot(st, 'One two three four five six seven').state
    const r2 = stabilizeEnInterimSnapshot(st, 'One two three')
    expect(r2.text).toBe('One two three four five six seven')
  })
})
