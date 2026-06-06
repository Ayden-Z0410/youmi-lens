import { describe, expect, it, vi } from 'vitest'
import {
  nextWatchState,
  dataSourceLabel,
  dataSourceTone,
  coverageText,
  handleWatchResult,
  unauthorizedGateAction,
  type WatchDataState,
} from './watchPageState'
import type { WatchCoverage } from '../types/api'

const prev: WatchDataState<{ n: number }> = {
  data: { n: 1 },
  source: 'local-fallback',
  coverage: null,
  unauthorized: false,
  error: null,
}

describe('nextWatchState', () => {
  it('adopts live data and source on ok-live', () => {
    const s = nextWatchState(prev, { status: 'ok', source: 'live', coverage: null, data: { n: 2 } })
    expect(s).toEqual({
      data: { n: 2 },
      source: 'live',
      coverage: null,
      unauthorized: false,
      error: null,
    })
  })

  it('preserves the server "mock" source (never upgraded to live)', () => {
    const s = nextWatchState(prev, { status: 'ok', source: 'mock', coverage: null, data: { n: 3 } })
    expect(s.source).toBe('mock')
    expect(s.data).toEqual({ n: 3 })
  })

  it('adopts partial source and its coverage on ok-partial', () => {
    const coverage: WatchCoverage = {
      providersWithRealData: ['brevo'],
      providersExpected: ['deepgram', 'dashscope', 'brevo', 'railway', 'supabase'],
      sectionsLive: ['costSummary'],
      sectionsMock: ['providerCoverage'],
      completenessPct: 20,
    }
    const s = nextWatchState(prev, { status: 'ok', source: 'partial', coverage, data: { n: 4 } })
    expect(s.source).toBe('partial')
    expect(s.coverage).toEqual(coverage)
  })

  it('flags unauthorized and keeps prior data (not silently mock)', () => {
    const s = nextWatchState(
      { ...prev, source: 'mock', data: { n: 5 } },
      { status: 'unauthorized', reason: 'forbidden' },
    )
    expect(s.unauthorized).toBe(true)
    expect(s.source).toBe('local-fallback')
    expect(s.data).toEqual({ n: 5 }) // kept; not replaced
    expect(s.error).toBe('forbidden')
  })

  it('keeps data and marks local-fallback on network/server error', () => {
    const s = nextWatchState(
      { data: { n: 9 }, source: 'live', coverage: null, unauthorized: false, error: null },
      { status: 'error', error: 'network' },
    )
    expect(s.source).toBe('local-fallback')
    expect(s.unauthorized).toBe(false)
    expect(s.data).toEqual({ n: 9 })
  })
})

describe('dataSourceLabel', () => {
  it('labels each state (mock / partial / live / local-fallback)', () => {
    expect(dataSourceLabel({ source: 'live' })).toBe('Live data')
    expect(dataSourceLabel({ source: 'partial' })).toBe('Partial data')
    expect(dataSourceLabel({ source: 'mock' })).toBe('Server mock')
    expect(dataSourceLabel({ source: 'local-fallback' })).toBe('Local fallback')
    expect(dataSourceLabel({ source: 'mock', unauthorized: true })).toBe('Access error')
  })

  it('never labels server mock or partial as Live', () => {
    expect(dataSourceLabel({ source: 'mock' })).not.toBe('Live data')
    expect(dataSourceLabel({ source: 'partial' })).not.toBe('Live data')
  })
})

describe('dataSourceTone', () => {
  it('maps tone per state', () => {
    expect(dataSourceTone({ source: 'live' })).toBe('live')
    expect(dataSourceTone({ source: 'partial' })).toBe('partial')
    expect(dataSourceTone({ source: 'mock' })).toBe('mock')
    expect(dataSourceTone({ source: 'local-fallback' })).toBe('fallback')
    expect(dataSourceTone({ source: 'live', unauthorized: true })).toBe('error')
  })
})

describe('coverageText', () => {
  const partialCoverage: WatchCoverage = {
    providersWithRealData: ['brevo'],
    providersExpected: ['deepgram', 'dashscope', 'brevo', 'railway', 'supabase'],
    sectionsLive: ['costSummary'],
    sectionsMock: ['providerCoverage'],
    completenessPct: 20,
  }

  it('summarises partial provider coverage', () => {
    expect(coverageText('partial', partialCoverage)).toBe('Real data for 1 of 5 providers.')
  })

  it('returns "" for non-partial sources', () => {
    expect(coverageText('live', partialCoverage)).toBe('')
    expect(coverageText('mock', partialCoverage)).toBe('')
    expect(coverageText('local-fallback', partialCoverage)).toBe('')
  })

  it('returns "" when there is no coverage metadata', () => {
    expect(coverageText('partial', null)).toBe('')
  })

  it('falls back to section coverage when all providers are present', () => {
    const sectionCoverage: WatchCoverage = {
      providersWithRealData: ['deepgram', 'dashscope', 'brevo', 'railway', 'supabase'],
      providersExpected: ['deepgram', 'dashscope', 'brevo', 'railway', 'supabase'],
      sectionsLive: ['security'],
      sectionsMock: ['providerConnections'],
      completenessPct: 50,
    }
    expect(coverageText('partial', sectionCoverage)).toBe('1 of 2 sections live.')
  })

  it('uses section wording (not "0 of 5 providers") when no provider has real data', () => {
    // Alerts-style: seeded rules but no fired alerts — no provider dimension.
    const alertsCoverage: WatchCoverage = {
      providersWithRealData: [],
      providersExpected: ['deepgram', 'dashscope', 'brevo', 'railway', 'supabase'],
      sectionsLive: ['alertRules'],
      sectionsMock: ['alertActivity'],
      completenessPct: 50,
    }
    expect(coverageText('partial', alertsCoverage)).toBe('1 of 2 sections live.')
  })
})

describe('unauthorizedGateAction', () => {
  it('401 → sign-in, 403 → Access denied', () => {
    expect(unauthorizedGateAction('not_signed_in')).toBe('signin')
    expect(unauthorizedGateAction('forbidden')).toBe('denied')
  })
})

describe('handleWatchResult (401/403 escalation)', () => {
  type S = WatchDataState<{ n: number }>
  const seed: S = { data: { n: 1 }, source: 'mock', coverage: null, unauthorized: false, error: null }

  it('401 escalates to the gate and does NOT apply fallback data', () => {
    const gate = { reportUnauthorized: vi.fn() }
    const applyState = vi.fn()
    const r = handleWatchResult<{ n: number }>(
      { status: 'unauthorized', reason: 'not_signed_in' },
      gate,
      applyState,
    )
    expect(r.escalated).toBe(true)
    expect(gate.reportUnauthorized).toHaveBeenCalledWith('not_signed_in')
    expect(applyState).not.toHaveBeenCalled() // never shown as mock/fallback
  })

  it('403 escalates to the gate (Access denied)', () => {
    const gate = { reportUnauthorized: vi.fn() }
    const applyState = vi.fn()
    const r = handleWatchResult<{ n: number }>(
      { status: 'unauthorized', reason: 'forbidden' },
      gate,
      applyState,
    )
    expect(r.escalated).toBe(true)
    expect(gate.reportUnauthorized).toHaveBeenCalledWith('forbidden')
    expect(applyState).not.toHaveBeenCalled()
  })

  it('network/5xx error is NOT escalated — keeps page usable as local-fallback', () => {
    const gate = { reportUnauthorized: vi.fn() }
    const applyState = vi.fn()
    const r = handleWatchResult<{ n: number }>({ status: 'error', error: 'network' }, gate, applyState)
    expect(r.escalated).toBe(false)
    expect(gate.reportUnauthorized).not.toHaveBeenCalled()
    const next = (applyState.mock.calls[0][0] as (p: S) => S)(seed)
    expect(next.source).toBe('local-fallback')
    expect(next.unauthorized).toBe(false)
  })

  it('http_500 is NOT escalated either', () => {
    const gate = { reportUnauthorized: vi.fn() }
    const applyState = vi.fn()
    handleWatchResult<{ n: number }>({ status: 'error', error: 'http_500' }, gate, applyState)
    expect(gate.reportUnauthorized).not.toHaveBeenCalled()
    expect(applyState).toHaveBeenCalled()
  })

  it('ok applies server data (no escalation)', () => {
    const applyState = vi.fn()
    const r = handleWatchResult<{ n: number }>(
      { status: 'ok', source: 'live', coverage: null, data: { n: 9 } },
      { reportUnauthorized: vi.fn() },
      applyState,
    )
    expect(r.escalated).toBe(false)
    const next = (applyState.mock.calls[0][0] as (p: S) => S)(seed)
    expect(next).toMatchObject({ source: 'live', data: { n: 9 } })
  })

  it('unauthorized WITHOUT a gate falls back to flagging unauthorized (no crash)', () => {
    const applyState = vi.fn()
    const r = handleWatchResult<{ n: number }>(
      { status: 'unauthorized', reason: 'forbidden' },
      null,
      applyState,
    )
    expect(r.escalated).toBe(false)
    const next = (applyState.mock.calls[0][0] as (p: S) => S)(seed)
    expect(next.unauthorized).toBe(true)
  })
})
