import { describe, expect, it } from 'vitest'
import {
  EXPECTED_PROVIDERS,
  realExpectedProviders,
  pct,
  decideSource,
  makeCoverage,
} from './watchCoverage.mjs'

describe('realExpectedProviders', () => {
  it('returns expected providers with data, in canonical order, ignoring unknowns', () => {
    expect(realExpectedProviders(['supabase', 'brevo', 'mystery'])).toEqual(['brevo', 'supabase'])
    expect(realExpectedProviders([])).toEqual([])
    expect(realExpectedProviders(['brevo', 'brevo'])).toEqual(['brevo'])
  })
})

describe('pct', () => {
  it('computes integer percentages, guarding divide-by-zero', () => {
    expect(pct(1, 5)).toBe(20)
    expect(pct(5, 5)).toBe(100)
    expect(pct(0, 0)).toBe(0)
  })
})

describe('decideSource', () => {
  it('mock when no real data', () => {
    expect(decideSource({ hasAnyReal: false, complete: false })).toBe('mock')
    expect(decideSource({ hasAnyReal: false, complete: true })).toBe('mock')
  })
  it('partial when some real data but not complete', () => {
    expect(decideSource({ hasAnyReal: true, complete: false })).toBe('partial')
  })
  it('live only when real and complete', () => {
    expect(decideSource({ hasAnyReal: true, complete: true })).toBe('live')
  })
})

describe('makeCoverage', () => {
  it('assembles a typed coverage object with the expected provider list', () => {
    const c = makeCoverage({ providersWithRealData: ['brevo'], completenessPct: 20 })
    expect(c.providersWithRealData).toEqual(['brevo'])
    expect(c.providersExpected).toEqual([...EXPECTED_PROVIDERS])
    expect(c.completenessPct).toBe(20)
  })
  it('defaults completenessPct to the section ratio', () => {
    const c = makeCoverage({ sectionsLive: ['a', 'b', 'c'], sectionsMock: ['d'] })
    expect(c.completenessPct).toBe(75)
  })
})
