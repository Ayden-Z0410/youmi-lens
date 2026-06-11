import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { recordMock, getAdminClientMock, requireWatchAdminMock } = vi.hoisted(() => ({
  recordMock: vi.fn(),
  getAdminClientMock: vi.fn(),
  requireWatchAdminMock: vi.fn(),
}))

vi.mock('./watchLedger.mjs', () => ({ recordWatchProviderSnapshot: recordMock }))
vi.mock('./betaGate.mjs', () => ({ getAdminClient: getAdminClientMock }))
vi.mock('./adminWatchAccess.mjs', () => ({ requireWatchAdmin: requireWatchAdminMock }))

import {
  probeSupabaseSnapshot,
  probeRailwaySnapshot,
  createSnapshotRefresher,
  handleWatchSnapshotsRefresh,
  LATENCY_DEGRADED_MS,
} from './watchSnapshots.mjs'

const FAKE_HEALTH_URL = 'https://internal-health.test/api/health'

/** Awaitable Supabase-builder mock; tables[name] = rows array or { error }. */
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

/** Deterministic clock: each call advances by stepMs. */
function ticker(stepMs = 10) {
  let t = 1_000_000
  return () => {
    t += stepMs
    return t
  }
}

function healthOk() {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }))
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

beforeEach(() => {
  recordMock.mockReset()
  recordMock.mockResolvedValue({ ok: true, id: 'snap-1' })
  getAdminClientMock.mockReset()
  requireWatchAdminMock.mockReset()
})
afterEach(() => vi.restoreAllMocks())

// ── individual probes ───────────────────────────────────────────────────────

describe('probeSupabaseSnapshot', () => {
  it('successful probe yields an operational row with measured latency and safe metadata', async () => {
    const r = await probeSupabaseSnapshot({
      getClient: () => mockClient({ watch_config: [] }),
      now: ticker(40),
    })
    expect(r.row).toEqual({
      provider: 'supabase',
      status: 'operational',
      latency_ms: 40,
      detail: 'PostgREST head-count probe',
      metadata: { probe: 'postgrest_head', target_table: 'watch_config', probe_ok: true },
    })
  })

  it('missing client skips — never a misleading offline row', async () => {
    expect(await probeSupabaseSnapshot({ getClient: () => null })).toEqual({ skipped: 'no_client' })
  })

  it('probe failure (query error or throw) yields an honest offline row without throwing', async () => {
    const errored = await probeSupabaseSnapshot({
      getClient: () => mockClient({ watch_config: { error: { message: 'db down' } } }),
      now: ticker(25),
    })
    expect(errored.row).toMatchObject({
      provider: 'supabase',
      status: 'offline',
      latency_ms: 25,
      metadata: { probe_ok: false },
    })

    const threw = await probeSupabaseSnapshot({
      getClient: () => ({ from: () => { throw new Error('boom') } }),
      now: ticker(5),
    })
    expect(threw.row).toMatchObject({ provider: 'supabase', status: 'offline' })
  })

  it('slow-but-successful probe is degraded, not offline', async () => {
    const r = await probeSupabaseSnapshot({
      getClient: () => mockClient({ watch_config: [] }),
      now: ticker(LATENCY_DEGRADED_MS + 200),
    })
    expect(r.row.status).toBe('degraded')
    expect(r.row.metadata.probe_ok).toBe(true)
  })
})

describe('probeRailwaySnapshot', () => {
  it('healthy endpoint yields operational with http_status and safe metadata', async () => {
    const fetchImpl = healthOk()
    const r = await probeRailwaySnapshot({
      fetchImpl,
      healthUrl: () => FAKE_HEALTH_URL,
      now: ticker(60),
    })
    expect(r.row).toEqual({
      provider: 'railway',
      status: 'operational',
      latency_ms: 60,
      detail: 'Application health probe',
      metadata: { probe: 'self_health', probe_ok: true, http_status: 200 },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('timeout/network failure yields offline (no http_status) without throwing', async () => {
    const r = await probeRailwaySnapshot({
      fetchImpl: vi.fn(async () => {
        throw new Error('aborted')
      }),
      healthUrl: () => FAKE_HEALTH_URL,
      now: ticker(15),
    })
    expect(r.row).toMatchObject({ provider: 'railway', status: 'offline' })
    expect(r.row.metadata).toEqual({ probe: 'self_health', probe_ok: false })
  })

  it('HTTP error status yields offline with the status code recorded', async () => {
    const r = await probeRailwaySnapshot({
      fetchImpl: vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
      healthUrl: () => FAKE_HEALTH_URL,
      now: ticker(10),
    })
    expect(r.row.status).toBe('offline')
    expect(r.row.metadata).toEqual({ probe: 'self_health', probe_ok: false, http_status: 503 })
  })

  it('missing health URL skips', async () => {
    expect(await probeRailwaySnapshot({ healthUrl: () => '' })).toEqual({ skipped: 'no_health_url' })
  })
})

// ── refresher: cooldown, in-flight guard, summary ───────────────────────────

describe('createSnapshotRefresher', () => {
  function freshClient(extraTables = {}) {
    return mockClient({ watch_provider_snapshots: [], watch_config: [], ...extraTables })
  }

  it('writes both snapshots and reports them as refreshed', async () => {
    const refresh = createSnapshotRefresher({
      getClient: () => freshClient(),
      record: recordMock,
      fetchImpl: healthOk(),
      healthUrl: () => FAKE_HEALTH_URL,
      now: ticker(10),
    })
    const summary = await refresh()
    expect(summary).toEqual({ ok: true, refreshed: ['supabase', 'railway'], skipped: [], failed: [] })
    expect(recordMock).toHaveBeenCalledTimes(2)
    expect(recordMock.mock.calls.map((c) => c[0].provider)).toEqual(['supabase', 'railway'])
  })

  it('cooldown skips providers with a fresh snapshot and runs no probe for them', async () => {
    const nowFn = ticker(10)
    const fetchImpl = healthOk()
    const refresh = createSnapshotRefresher({
      getClient: () =>
        mockClient({
          // Cooldown read returns BOTH providers as fresh.
          watch_provider_snapshots: [
            { provider: 'supabase', captured_at: new Date().toISOString() },
            { provider: 'railway', captured_at: new Date().toISOString() },
          ],
          watch_config: [],
        }),
      record: recordMock,
      fetchImpl,
      healthUrl: () => FAKE_HEALTH_URL,
      now: nowFn,
    })
    const summary = await refresh()
    expect(summary.refreshed).toEqual([])
    expect(summary.skipped).toEqual([
      { provider: 'supabase', reason: 'cooldown' },
      { provider: 'railway', reason: 'cooldown' },
    ])
    expect(recordMock).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled() // probe never ran
  })

  it('missing supabase client skips supabase (no misleading row)', async () => {
    const refresh = createSnapshotRefresher({
      getClient: () => null,
      record: recordMock,
      fetchImpl: healthOk(),
      healthUrl: () => FAKE_HEALTH_URL,
      now: ticker(10),
    })
    const summary = await refresh()
    expect(summary.skipped).toContainEqual({ provider: 'supabase', reason: 'no_client' })
    expect(recordMock.mock.calls.map((c) => c[0].provider)).toEqual(['railway'])
  })

  it('in-flight guard: concurrent calls share one run (no duplicate probes/writes)', async () => {
    let release
    const gate = new Promise((r) => {
      release = r
    })
    // Slow supabase probe: the cooldown read resolves immediately, the
    // watch_config probe waits on the gate so both refresh() calls overlap.
    const slowClient = {
      from: (table) => {
        const builder = {
          select: () => builder,
          eq: () => builder,
          in: () => builder,
          gte: () => builder,
          limit: () => builder,
          then: (resolve) => {
            if (table === 'watch_config') {
              gate.then(() => resolve({ data: [], error: null }))
            } else {
              resolve({ data: [], error: null })
            }
          },
        }
        return builder
      },
    }
    const fetchImpl = healthOk()
    const refresh = createSnapshotRefresher({
      getClient: () => slowClient,
      record: recordMock,
      fetchImpl,
      healthUrl: () => FAKE_HEALTH_URL,
      now: ticker(10),
    })
    const p1 = refresh()
    const p2 = refresh()
    release()
    const [s1, s2] = await Promise.all([p1, p2])
    expect(recordMock).toHaveBeenCalledTimes(2) // supabase + railway ONCE each
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(s1).toEqual(s2)
  })

  it('ledger write failure is reported per provider without throwing', async () => {
    recordMock.mockResolvedValue({ ok: false, error: 'insert_failed' })
    const refresh = createSnapshotRefresher({
      getClient: () => freshClient(),
      record: recordMock,
      fetchImpl: healthOk(),
      healthUrl: () => FAKE_HEALTH_URL,
      now: ticker(10),
    })
    const summary = await refresh()
    expect(summary.failed).toEqual([
      { provider: 'supabase', reason: 'ledger_write_failed' },
      { provider: 'railway', reason: 'ledger_write_failed' },
    ])
  })

  it('rows never contain the health URL, keys, headers, env values, or raw responses', async () => {
    const refresh = createSnapshotRefresher({
      getClient: () => freshClient(),
      record: recordMock,
      fetchImpl: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, secretField: 'sk-leak', internalUrl: FAKE_HEALTH_URL }),
      })),
      healthUrl: () => FAKE_HEALTH_URL,
      now: ticker(10),
    })
    await refresh()
    for (const call of recordMock.mock.calls) {
      const serialized = JSON.stringify(call[0])
      expect(serialized).not.toContain(FAKE_HEALTH_URL)
      expect(serialized).not.toContain('internal-health.test')
      expect(serialized).not.toContain('sk-leak')
      expect(serialized).not.toContain('secretField')
      expect(serialized).not.toContain('Bearer')
      expect(serialized.toLowerCase()).not.toContain('authorization')
    }
    // Metadata is exactly the fixed descriptor sets.
    const [supabaseRow, railwayRow] = recordMock.mock.calls.map((c) => c[0])
    expect(Object.keys(supabaseRow.metadata).sort()).toEqual(['probe', 'probe_ok', 'target_table'])
    expect(Object.keys(railwayRow.metadata).sort()).toEqual(['http_status', 'probe', 'probe_ok'])
  })
})

// ── endpoint handler ────────────────────────────────────────────────────────

describe('handleWatchSnapshotsRefresh', () => {
  it('requires admin: unauthorized requests never reach the refresher', async () => {
    requireWatchAdminMock.mockImplementation(async (_req, res) => {
      res.status(403).json({ ok: false, error: 'forbidden' })
      return null
    })
    const res = fakeRes()
    await handleWatchSnapshotsRefresh({ headers: {} }, res)
    expect(res.statusCode).toBe(403)
    expect(getAdminClientMock).not.toHaveBeenCalled()
    expect(recordMock).not.toHaveBeenCalled()
  })

  it('authorized requests get a sanitized summary only', async () => {
    requireWatchAdminMock.mockResolvedValue({ userId: 'admin-1', email: 'dev@example.com' })
    getAdminClientMock.mockReturnValue(
      mockClient({ watch_provider_snapshots: [], watch_config: [] }),
    )
    vi.stubGlobal('fetch', healthOk())
    const res = fakeRes()
    await handleWatchSnapshotsRefresh({ headers: {} }, res)
    vi.unstubAllGlobals()

    expect(res.statusCode).toBe(200)
    expect(Object.keys(res.body).sort()).toEqual(['failed', 'ok', 'refreshed', 'skipped'])
    expect(res.body.ok).toBe(true)
    expect(res.body.refreshed).toEqual(['supabase', 'railway'])
    const serialized = JSON.stringify(res.body)
    expect(serialized).not.toMatch(/https?:\/\//)
    expect(serialized.toLowerCase()).not.toMatch(/key|token|secret|stack|bearer/)
  })
})
