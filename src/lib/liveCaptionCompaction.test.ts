import { describe, expect, it } from 'vitest'
import { compactLiveEnglishSnapshot, compactLiveZhSnapshot } from './liveCaptionCompaction'

describe('compactLiveEnglishSnapshot', () => {
  it('leaves short lines unchanged', () => {
    expect(compactLiveEnglishSnapshot('Hello.')).toBe('Hello.')
  })

  it('collapses exact doubled body (no spacer break)', () => {
    const a = 'We study the class structure today'
    expect(compactLiveEnglishSnapshot(`${a}${a}`)).toBe(a)
  })

  it('collapses doubled trailing word block', () => {
    const line =
      'The point is clear the point is clear the point is clear the point is clear'
    const out = compactLiveEnglishSnapshot(line)
    expect(out.toLowerCase()).toContain('the point is clear')
    expect(out.length).toBeLessThan(line.length)
  })

  it('merges adjacent duplicate sentences', () => {
    const s = 'Done. Done. Next step follows.'
    expect(compactLiveEnglishSnapshot(s)).toBe('Done. Next step follows.')
  })

  it('is idempotent on a messy interim', () => {
    const once = compactLiveEnglishSnapshot('A A A A B B')
    const twice = compactLiveEnglishSnapshot(once)
    expect(twice).toBe(once)
  })
})

describe('compactLiveZhSnapshot', () => {
  it('merges adjacent duplicate clauses', () => {
    const clause = '\u8FD9\u662F\u7B2C\u4E00\u53E5' // ?????
    const s = `${clause}\u3002${clause}\u3002\u7136\u540E\u7EE7\u7EED\u3002`
    const out = compactLiveZhSnapshot(s)
    expect(out).toContain(clause)
    expect(out.indexOf(clause)).toBe(out.lastIndexOf(clause))
  })
})
