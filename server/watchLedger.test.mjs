import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getAdminClientMock, capture } = vi.hoisted(() => ({
  getAdminClientMock: vi.fn(),
  capture: { table: null, row: null },
}))

vi.mock('./betaGate.mjs', () => ({ getAdminClient: getAdminClientMock }))

import {
  recordWatchCostEvent,
  recordWatchProviderSnapshot,
  scrubMetadata,
} from './watchLedger.mjs'
import { PRICING, round6 } from './watchPricing.mjs'

/** A fake service-role client that captures the inserted row and returns `result`. */
function clientReturning(result) {
  return {
    from: (table) => ({
      insert: (row) => {
        capture.table = table
        capture.row = row
        return { select: () => ({ single: async () => result }) }
      },
    }),
  }
}

function clientThrowing() {
  return {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => {
            throw new Error('network down')
          },
        }),
      }),
    }),
  }
}

beforeEach(() => {
  capture.table = null
  capture.row = null
  getAdminClientMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── scrubMetadata ───────────────────────────────────────────────────────────

describe('scrubMetadata', () => {
  it('returns null for non-objects', () => {
    expect(scrubMetadata(null)).toBeNull()
    expect(scrubMetadata(undefined)).toBeNull()
    expect(scrubMetadata('hello')).toBeNull()
    expect(scrubMetadata(42)).toBeNull()
    expect(scrubMetadata([1, 2, 3])).toBeNull()
  })

  it('drops sensitive keys (keys, tokens, auth, transcript, audio, payload, password)', () => {
    const out = scrubMetadata({
      apiKey: 'sk-secret',
      token: 'abc',
      authorization: 'Bearer x',
      password: 'p',
      transcript: 'long spoken text',
      audio: 'blob',
      payload: { big: 'thing' },
      model: 'qwen-turbo',
      region: 'us',
    })
    expect(out).toEqual({ model: 'qwen-turbo', region: 'us' })
  })

  it('drops oversized strings but keeps small scalars', () => {
    const out = scrubMetadata({ short: 'hello', big: 'x'.repeat(300), n: 7, ok: true })
    expect(out).toEqual({ short: 'hello', n: 7, ok: true })
  })

  it('keeps a small shallow nested object but drops deep/large nesting', () => {
    const out = scrubMetadata({
      meta: { a: 1, b: 'two', secret: 'no' },
      deep: { level1: { level2: 'too deep' } },
    })
    expect(out.meta).toEqual({ a: 1, b: 'two' })
    expect(out.deep).toBeUndefined()
  })

  it('returns null when nothing survives scrubbing', () => {
    expect(scrubMetadata({ apiKey: 'x', token: 'y' })).toBeNull()
  })
})

// ── recordWatchCostEvent ────────────────────────────────────────────────────

describe('recordWatchCostEvent', () => {
  it('inserts a normalized row and returns { ok, id } on success', async () => {
    getAdminClientMock.mockReturnValue(clientReturning({ data: { id: 'cost-1' }, error: null }))
    const res = await recordWatchCostEvent({
      provider: 'Deepgram',
      event_type: ' live_transcription ',
      unit: 'min',
      quantity: 10,
    })
    expect(res).toEqual({ ok: true, id: 'cost-1' })
    expect(capture.table).toBe('watch_cost_events')
    expect(capture.row).toMatchObject({
      provider: 'deepgram',
      event_type: 'live_transcription',
      unit: 'minutes',
      quantity: 10,
      status: 'recorded',
      source: 'internal',
      user_id: null,
      recording_id: null,
      metadata: null,
    })
    expect(capture.row.estimated_cost_usd).toBe(round6(10 * PRICING.deepgram.minutes))
  })

  it('derives estimated cost when omitted, but respects a provided value', async () => {
    getAdminClientMock.mockReturnValue(clientReturning({ data: { id: 'c' }, error: null }))
    await recordWatchCostEvent({ provider: 'brevo', event_type: 'email_send', unit: 'emails', quantity: 4 })
    expect(capture.row.estimated_cost_usd).toBe(round6(4 * PRICING.brevo.emails))

    await recordWatchCostEvent({
      provider: 'brevo',
      event_type: 'email_send',
      unit: 'emails',
      quantity: 4,
      estimated_cost_usd: 1.23,
    })
    expect(capture.row.estimated_cost_usd).toBe(1.23)
  })

  it('scrubs metadata before insert', async () => {
    getAdminClientMock.mockReturnValue(clientReturning({ data: { id: 'c' }, error: null }))
    await recordWatchCostEvent({
      provider: 'dashscope',
      event_type: 'summary',
      unit: 'tokens_out',
      quantity: 1000,
      metadata: { apiKey: 'sk-x', model: 'qwen', transcript: 'secret text' },
    })
    expect(capture.row.metadata).toEqual({ model: 'qwen' })
  })

  it('rejects invalid provider/event_type/unit WITHOUT touching the DB', async () => {
    expect(await recordWatchCostEvent({ provider: 'nope', event_type: 'x', unit: 'minutes', quantity: 1 }))
      .toEqual({ ok: false, error: 'invalid_provider' })
    expect(await recordWatchCostEvent({ provider: 'deepgram', event_type: '  ', unit: 'minutes', quantity: 1 }))
      .toEqual({ ok: false, error: 'invalid_event_type' })
    expect(await recordWatchCostEvent({ provider: 'deepgram', event_type: 'x', unit: '', quantity: 1 }))
      .toEqual({ ok: false, error: 'invalid_unit' })
    expect(getAdminClientMock).not.toHaveBeenCalled()
  })

  it('returns ok:false (no throw) when the insert errors', async () => {
    getAdminClientMock.mockReturnValue(clientReturning({ data: null, error: { message: 'boom' } }))
    const res = await recordWatchCostEvent({ provider: 'deepgram', event_type: 'x', unit: 'minutes', quantity: 1 })
    expect(res).toEqual({ ok: false, error: 'boom' })
  })

  it('returns ok:false (no throw) when the insert throws', async () => {
    getAdminClientMock.mockReturnValue(clientThrowing())
    const res = await recordWatchCostEvent({ provider: 'deepgram', event_type: 'x', unit: 'minutes', quantity: 1 })
    expect(res).toEqual({ ok: false, error: 'network down' })
  })

  it('returns ok:false when no service-role client is available', async () => {
    getAdminClientMock.mockReturnValue(null)
    const res = await recordWatchCostEvent({ provider: 'deepgram', event_type: 'x', unit: 'minutes', quantity: 1 })
    expect(res).toEqual({ ok: false, error: 'no_admin_client' })
  })
})

// ── recordWatchProviderSnapshot ─────────────────────────────────────────────

describe('recordWatchProviderSnapshot', () => {
  it('inserts a normalized snapshot row on success', async () => {
    getAdminClientMock.mockReturnValue(clientReturning({ data: { id: 'snap-1' }, error: null }))
    const res = await recordWatchProviderSnapshot({
      provider: 'Supabase',
      status: 'Degraded',
      latency_ms: 162.6,
      quota_used_pct: 78,
    })
    expect(res).toEqual({ ok: true, id: 'snap-1' })
    expect(capture.table).toBe('watch_provider_snapshots')
    expect(capture.row).toMatchObject({
      provider: 'supabase',
      status: 'degraded',
      latency_ms: 163,
      quota_used_pct: 78,
      health_pct: null,
      usage_value: null,
      metadata: null,
    })
  })

  it('rejects invalid provider/status without touching the DB', async () => {
    expect(await recordWatchProviderSnapshot({ provider: 'nope', status: 'operational' }))
      .toEqual({ ok: false, error: 'invalid_provider' })
    expect(await recordWatchProviderSnapshot({ provider: 'railway', status: 'on-fire' }))
      .toEqual({ ok: false, error: 'invalid_status' })
    expect(getAdminClientMock).not.toHaveBeenCalled()
  })

  it('returns ok:false (no throw) on insert failure', async () => {
    getAdminClientMock.mockReturnValue(clientReturning({ data: null, error: { message: 'db error' } }))
    const res = await recordWatchProviderSnapshot({ provider: 'railway', status: 'operational' })
    expect(res).toEqual({ ok: false, error: 'db error' })
  })
})
