import { describe, expect, it } from 'vitest'
import { canonicalizeLectureTranscript, transcriptCanonicalQualityGate } from './transcriptCanonicalCore.js'

describe('canonicalizeLectureTranscript', () => {
  it('merges adjacent near-duplicate sentences (revision)', () => {
    const raw = 'The particles are tiny. The particles are tiny drifters in the fluid.'
    const { canonical } = canonicalizeLectureTranscript(raw)
    expect(canonical.toLowerCase()).toContain('drifters')
    expect(canonical).not.toMatch(/tiny\.\s+The particles are tiny\./i)
  })

  it('collapses repeated run of sentences', () => {
    const raw = 'Hello world. Hello world. Hello world. Next idea.'
    const { canonical, diagnostics } = canonicalizeLectureTranscript(raw)
    const lower = canonical.toLowerCase()
    const count = lower.split('hello world').length - 1
    expect(count).toBeLessThan(3)
    expect(diagnostics.droppedNearDupPairs + diagnostics.droppedRepeatedRuns).toBeGreaterThan(0)
  })

  it('canonicalizes bilingual live layout without dropping track labels', () => {
    const raw = `[Track A  speech en-US]
One two. One two three.

[Track B  Simplified Chinese]
Yi er. Yi er san.`
    const { canonical } = canonicalizeLectureTranscript(raw)
    expect(canonical).toMatch(/\[Track A/i)
    expect(canonical).toMatch(/\[Track B/i)
    expect(canonical).toMatch(/Yi er/)
  })

  it('quality gate rejects empty', () => {
    expect(transcriptCanonicalQualityGate('   ').ok).toBe(false)
    expect(transcriptCanonicalQualityGate('Some real text here.').ok).toBe(true)
  })
})
