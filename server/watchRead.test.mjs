import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { requireWatchAdminMock, getAdminClientMock } = vi.hoisted(() => ({
  requireWatchAdminMock: vi.fn(),
  getAdminClientMock: vi.fn(),
}))

vi.mock('./adminWatchAccess.mjs', () => ({ requireWatchAdmin: requireWatchAdminMock }))
vi.mock('./betaGate.mjs', () => ({ getAdminClient: getAdminClientMock }))

import {
  aggregateCostRows,
  latestSnapshotPerProvider,
  costRowToLogEntry,
  handleWatchOverview,
  handleWatchProviders,
  handleWatchAlerts,
  handleWatchCosts,
  handleWatchSettings,
  handleWatchLogs,
} from './watchRead.mjs'

const DAY = 86400000

/** Awaitable Supabase-builder mock; `tables[name]` = rows array (or {error}). */
function mockClient(tables) {
  const make = (table) => {
    const t = tables[table]
    const data = Array.isArray(t) ? t : (t?.data ?? [])
    const error = t && !Array.isArray(t) ? (t.error ?? null) : null
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      gte: () => builder,
      lte: () => builder,
      order: () => builder,
      limit: () => builder,
      then: (resolve, reject) => Promise.resolve({ data, error }).then(resolve, reject),
    }
    return builder
  }
  return { from: make }
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c
      return this
    },
    json(o) {
      this.body = o
      return this
    },
  }
}

function authorize() {
  requireWatchAdminMock.mockResolvedValue({ userId: 'u1', email: 'dev@example.com' })
}
function denyWith403() {
  requireWatchAdminMock.mockImplementation(async (_req, res) => {
    res.status(403).json({ ok: false, error: 'forbidden', reason: 'not_admin' })
    return null
  })
}

beforeEach(() => {
  requireWatchAdminMock.mockReset()
  getAdminClientMock.mockReset()
})
afterEach(() => vi.restoreAllMocks())

// ── pure helpers ────────────────────────────────────────────────────────────

describe('aggregateCostRows', () => {
  it('rolls up total/today/week and per-provider spend', () => {
    const now = Date.now()
    const rows = [
      { provider: 'deepgram', estimated_cost_usd: 1, occurred_at: new Date(now).toISOString() },
      { provider: 'dashscope', estimated_cost_usd: 2, occurred_at: new Date(now - 2 * DAY).toISOString() },
      { provider: 'deepgram', estimated_cost_usd: 4, occurred_at: new Date(now - 10 * DAY).toISOString() },
    ]
    const agg = aggregateCostRows(rows, { now })
    expect(agg.total).toBe(7)
    expect(agg.today).toBe(1)
    expect(agg.week).toBe(3) // today + 2-days-ago
    expect(agg.byProvider).toEqual({ deepgram: 5, dashscope: 2 })
    expect(agg.trend.labels).toHaveLength(7)
    // only rows within the last 7 days appear in the trend (today + 2d ago)
    const trendTotal = agg.trend.series.flatMap((s) => s.points).reduce((a, b) => a + b, 0)
    expect(trendTotal).toBeCloseTo(3, 6)
  })

  it('is robust to empty / garbage input', () => {
    expect(aggregateCostRows(null).total).toBe(0)
    expect(aggregateCostRows([{ provider: 'x' }]).total).toBe(0)
  })
})

describe('latestSnapshotPerProvider', () => {
  it('keeps the most recent snapshot per provider', () => {
    const latest = latestSnapshotPerProvider([
      { provider: 'supabase', status: 'operational', captured_at: '2026-01-01T00:00:00Z' },
      { provider: 'supabase', status: 'degraded', captured_at: '2026-01-02T00:00:00Z' },
      { provider: 'railway', status: 'operational', captured_at: '2026-01-01T00:00:00Z' },
    ])
    expect(latest).toHaveLength(2)
    expect(latest.find((s) => s.provider === 'supabase').status).toBe('degraded')
  })
})

describe('costRowToLogEntry (sanitized)', () => {
  it('never includes metadata, transcripts, or raw fields', () => {
    const entry = costRowToLogEntry({
      id: 'abc-123-def',
      provider: 'deepgram',
      event_type: 'live_transcription',
      estimated_cost_usd: 0.14,
      occurred_at: new Date().toISOString(),
      metadata: { apiKey: 'sk-secret' },
      transcript: 'private spoken words',
    })
    expect(entry).not.toHaveProperty('metadata')
    expect(entry).not.toHaveProperty('transcript')
    const serialized = JSON.stringify(entry)
    expect(serialized).not.toContain('sk-secret')
    expect(serialized).not.toContain('private spoken')
    expect(entry.provider).toBe('Deepgram')
    expect(entry.event).toBe('live transcription')
    expect(entry.cost).toBe('$0.14')
  })
})

// ── handlers: auth ──────────────────────────────────────────────────────────

describe('read handlers — authorization', () => {
  it('rejects unauthorized requests before any DB access', async () => {
    denyWith403()
    const res = fakeRes()
    await handleWatchOverview({ headers: {} }, res)
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ ok: false, error: 'forbidden' })
    expect(getAdminClientMock).not.toHaveBeenCalled()
  })
})

// ── handlers: mock fallback when tables are empty ───────────────────────────

describe('read handlers — mock fallback', () => {
  beforeEach(authorize)

  it('overview returns mock fallback when cost events are empty', async () => {
    getAdminClientMock.mockReturnValue(mockClient({ watch_cost_events: [], watch_alerts: [] }))
    const res = fakeRes()
    await handleWatchOverview({ headers: {} }, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.source).toBe('mock')
    expect(res.body.metrics).toHaveLength(4)
  })

  it('settings returns mock fallback when rules and config are empty', async () => {
    getAdminClientMock.mockReturnValue(
      mockClient({ watch_alert_rules: [], watch_config: [], watch_provider_snapshots: [] }),
    )
    const res = fakeRes()
    await handleWatchSettings({ headers: {} }, res)
    expect(res.body.source).toBe('mock')
  })

  it('overview falls back to mock if the DB read throws (after auth passed)', async () => {
    getAdminClientMock.mockReturnValue(mockClient({ watch_cost_events: { error: { message: 'db down' } } }))
    const res = fakeRes()
    await handleWatchOverview({ headers: {} }, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.source).toBe('mock')
  })
})

// ── handlers: live data from seeded tables ──────────────────────────────────

describe('read handlers — live data', () => {
  beforeEach(authorize)

  it('settings returns seeded alert rules and config-derived notifications', async () => {
    getAdminClientMock.mockReturnValue(
      mockClient({
        watch_alert_rules: [
          { id: 'r1', provider: 'supabase', name: 'Supabase storage warning', condition: 'storage_used', threshold_value: 75, threshold_unit: 'percent', enabled: true },
          { id: 'r2', provider: 'brevo', name: 'Brevo credit minimum', condition: 'credits_remaining', threshold_value: 500, threshold_unit: 'count', enabled: true },
        ],
        watch_config: [
          { key: 'notification_channels', value: { email: { enabled: true }, desktop: { enabled: true }, slack: { enabled: false } } },
        ],
        watch_provider_snapshots: [],
      }),
    )
    const res = fakeRes()
    await handleWatchSettings({ headers: {} }, res)
    // Config/rules are real but provider connection statuses are unknown (no
    // snapshots) → the page is PARTIAL, never Live.
    expect(res.body.source).toBe('partial')
    expect(res.body.coverage.sectionsLive).toContain('alertThresholds')
    expect(res.body.coverage.sectionsMock).toContain('providerConnections')
    expect(res.body.alertThresholds).toHaveLength(2)
    expect(res.body.alertThresholds[0]).toMatchObject({ label: 'Supabase storage warning', threshold: '75%', enabled: true })
    // provider connections are present, marked unknown, and always masked
    for (const c of res.body.providerConnections) {
      expect(c.keyMasked).toBe('••••••••')
      expect(c.dataState).toBe('unknown')
    }
  })

  it('alerts: seeded rules + no fired alerts → partial, rows empty (never mock)', async () => {
    getAdminClientMock.mockReturnValue(
      mockClient({
        watch_alerts: [],
        watch_alert_rules: [
          { id: 'r1', provider: 'deepgram', condition: 'monthly_minutes', threshold_value: 80, threshold_unit: 'percent', channel: 'email', enabled: true },
        ],
      }),
    )
    const res = fakeRes()
    await handleWatchAlerts({ headers: {} }, res)
    expect(res.body.source).toBe('partial') // rules live, alert activity empty
    expect(res.body.rules).toHaveLength(1)
    expect(res.body.rules[0]).toMatchObject({ provider: 'Deepgram', threshold: '80%', enabled: true })
    expect(res.body.rows).toEqual([]) // honest empty, NOT mock activity
    expect(res.body.metrics.find((m) => m.id === 'active-alerts').value).toBe('0')
    expect(res.body.coverage.sectionsLive).toContain('alertRules')
    expect(res.body.coverage.sectionsMock).toContain('alertActivity')
  })

  it('logs sanitizes cost-event rows (no metadata leaks)', async () => {
    getAdminClientMock.mockReturnValue(
      mockClient({
        watch_cost_events: [
          { id: 'e1', provider: 'deepgram', event_type: 'live_transcription', estimated_cost_usd: 0.14, occurred_at: new Date().toISOString(), metadata: { apiKey: 'sk-x' } },
        ],
      }),
    )
    const res = fakeRes()
    await handleWatchLogs({ headers: {} }, res)
    // Real internal events make Logs live independently of other pages.
    expect(res.body.source).toBe('live')
    expect(res.body.rows).toHaveLength(1)
    expect(res.body.rows[0]).not.toHaveProperty('metadata')
    expect(JSON.stringify(res.body.rows)).not.toContain('sk-x')
    expect(res.body.coverage.completenessPct).toBe(100)
  })
})

// ── partial-coverage semantics ──────────────────────────────────────────────

describe('partial-coverage semantics', () => {
  beforeEach(authorize)
  const ts = () => new Date().toISOString()

  it('one provider cost event → costs PARTIAL (not live), forecast unreliable', async () => {
    getAdminClientMock.mockReturnValue(
      mockClient({
        watch_cost_events: [{ provider: 'brevo', estimated_cost_usd: 0.01, occurred_at: ts() }],
        watch_config: [{ key: 'monthly_budget_usd', value: 2500 }],
      }),
    )
    const res = fakeRes()
    await handleWatchCosts({ headers: {} }, res)
    expect(res.body.source).toBe('partial')
    expect(res.body.coverage.providersWithRealData).toEqual(['brevo'])
    expect(res.body.coverage.providersExpected).toHaveLength(5)
    expect(res.body.coverage.completenessPct).toBe(20)
    expect(res.body.forecast.reliable).toBe(false)
    expect(res.body.forecast.projectedCost).toBe('—')
  })

  it('one provider snapshot → providers PARTIAL with per-row data state', async () => {
    getAdminClientMock.mockReturnValue(
      mockClient({
        watch_provider_snapshots: [
          { provider: 'supabase', status: 'degraded', latency_ms: 162, health_pct: 97.2, captured_at: ts() },
        ],
      }),
    )
    const res = fakeRes()
    await handleWatchProviders({ headers: {} }, res)
    expect(res.body.source).toBe('partial')
    expect(res.body.providers).toHaveLength(5) // all expected providers listed
    const sup = res.body.providers.find((p) => p.id === 'supabase')
    const dg = res.body.providers.find((p) => p.id === 'deepgram')
    expect(sup.dataState).toBe('live')
    expect(dg.dataState).toBe('unknown')
    expect(res.body.coverage.completenessPct).toBe(20)
  })

  it('all expected provider snapshots → providers LIVE', async () => {
    const snaps = ['deepgram', 'dashscope', 'brevo', 'railway', 'supabase'].map((provider) => ({
      provider,
      status: 'operational',
      latency_ms: 20,
      health_pct: 99.9,
      captured_at: ts(),
    }))
    getAdminClientMock.mockReturnValue(mockClient({ watch_provider_snapshots: snaps }))
    const res = fakeRes()
    await handleWatchProviders({ headers: {} }, res)
    expect(res.body.source).toBe('live')
    expect(res.body.coverage.completenessPct).toBe(100)
    expect(res.body.providers.every((p) => p.dataState === 'live')).toBe(true)
  })

  it('empty tables still return mock for every endpoint', async () => {
    getAdminClientMock.mockReturnValue(mockClient({}))
    for (const handler of [handleWatchOverview, handleWatchProviders, handleWatchCosts]) {
      const res = fakeRes()
      await handler({ headers: {} }, res)
      expect(res.body.source).toBe('mock')
      expect(res.body.coverage.completenessPct).toBe(0)
    }
  })
})
