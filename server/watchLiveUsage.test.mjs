import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { recordMock } = vi.hoisted(() => ({ recordMock: vi.fn() }))
vi.mock('./watchLedger.mjs', () => ({ recordWatchCostEvent: recordMock }))

import {
  recordDeepgramLiveTranscriptionUsage,
  createDeepgramLiveCostFinalizer,
} from './watchLiveUsage.mjs'
import { PRICING, estimateCostUsd, round6 } from './watchPricing.mjs'

const T0 = 1_700_000_000_000

/** Factory inputs for a healthy 2-minute Deepgram session with audio. */
function session(overrides = {}) {
  return {
    provider: 'deepgram',
    userId: 'user-1',
    sessionId: 'abc123def456',
    startedAtMs: T0,
    language: 'en-US',
    model: 'nova-3',
    getFrameCount: () => 240,
    getFinalCount: () => 7,
    now: () => T0 + 120_000, // 120s wall clock
    ...overrides,
  }
}

beforeEach(() => {
  recordMock.mockReset()
  recordMock.mockResolvedValue({ ok: true, id: 'evt-1' })
})
afterEach(() => vi.restoreAllMocks())

describe('createDeepgramLiveCostFinalizer (Phase 5C-2)', () => {
  it('normal close records exactly one fully-shaped event', async () => {
    const finalize = createDeepgramLiveCostFinalizer(session())
    const r = finalize('stream_stop')
    expect(r.attempted).toBe(true)
    expect(await r.done).toMatchObject({ recorded: true, id: 'evt-1' })

    expect(recordMock).toHaveBeenCalledTimes(1)
    expect(recordMock).toHaveBeenCalledWith({
      provider: 'deepgram',
      event_type: 'live_transcription',
      quantity: 2, // 120s → 2 minutes
      unit: 'minutes',
      source: 'internal',
      status: 'recorded',
      user_id: 'user-1',
      recording_id: null,
      idempotency_key: 'deepgram:live:abc123def456',
      metadata: {
        session_id: 'abc123def456',
        close_reason: 'stream_stop',
        duration_source: 'wall_clock',
        chunk_count: 240,
        language: 'en-US',
        model: 'nova-3',
        has_final_transcript: true,
      },
    })
  })

  it('duplicate close paths (stream_stop then ws_close) only record once', async () => {
    const finalize = createDeepgramLiveCostFinalizer(session())
    expect(finalize('stream_stop').attempted).toBe(true)
    const second = finalize('ws_close')
    expect(second.attempted).toBe(false)
    expect(await second.done).toBeNull()
    expect(recordMock).toHaveBeenCalledTimes(1)
  })

  it('max-session timer then ws close only records once', () => {
    const finalize = createDeepgramLiveCostFinalizer(session())
    expect(finalize('session_limit').attempted).toBe(true)
    expect(finalize('ws_close').attempted).toBe(false)
    expect(recordMock).toHaveBeenCalledTimes(1)
    expect(recordMock.mock.calls[0][0].metadata.close_reason).toBe('session_limit')
  })

  it('failed/no-audio session records nothing', async () => {
    const finalize = createDeepgramLiveCostFinalizer(session({ getFrameCount: () => 0 }))
    const r = finalize('ws_close')
    expect(r.attempted).toBe(true) // funnel ran, but helper declined
    expect(await r.done).toEqual({ recorded: false, reason: 'no_audio' })
    expect(recordMock).not.toHaveBeenCalled()
  })

  it('zero or negative duration records nothing', async () => {
    const zero = createDeepgramLiveCostFinalizer(session({ now: () => T0 }))
    expect(await zero('ws_close').done).toEqual({ recorded: false, reason: 'no_duration' })
    const negative = createDeepgramLiveCostFinalizer(session({ now: () => T0 - 5000 }))
    expect(await negative('ws_close').done).toEqual({ recorded: false, reason: 'no_duration' })
    expect(recordMock).not.toHaveBeenCalled()
  })

  it('non-Deepgram provider records nothing', async () => {
    const finalize = createDeepgramLiveCostFinalizer(session({ provider: 'dashscope' }))
    expect(await finalize('stream_stop').done).toEqual({ recorded: false, reason: 'not_deepgram' })
    expect(recordMock).not.toHaveBeenCalled()
  })

  it('treats a durable duplicate idempotency_key as a safe duplicate (no throw)', async () => {
    recordMock.mockResolvedValueOnce({ ok: true, duplicate: true, id: null })
    const finalize = createDeepgramLiveCostFinalizer(session())
    expect(await finalize('ws_close').done).toEqual({ recorded: false, duplicate: true })
  })

  it('ledger failure or throw never propagates to session cleanup', async () => {
    recordMock.mockResolvedValueOnce({ ok: false, error: 'insert_failed' })
    const f1 = createDeepgramLiveCostFinalizer(session())
    expect(await f1('ws_close').done).toEqual({ recorded: false, reason: 'insert_failed' })

    recordMock.mockRejectedValueOnce(new Error('db down'))
    const f2 = createDeepgramLiveCostFinalizer(session({ sessionId: 'other-session' }))
    expect(await f2('ws_close').done).toEqual({ recorded: false, reason: 'threw' })
  })

  it('reconnect (new session id) produces a separate logical row', async () => {
    const a = createDeepgramLiveCostFinalizer(session({ sessionId: 'session-aaa' }))
    const b = createDeepgramLiveCostFinalizer(session({ sessionId: 'session-bbb' }))
    await a('ws_close').done
    await b('ws_close').done
    expect(recordMock).toHaveBeenCalledTimes(2)
    const keys = recordMock.mock.calls.map((c) => c[0].idempotency_key)
    expect(keys).toEqual(['deepgram:live:session-aaa', 'deepgram:live:session-bbb'])
  })

  it('same-WS re-stream_start: previous segment finalizes before the next starts, each once', async () => {
    // Mirrors the liveRealtimeWs wiring: segment 1 uses the bare wsSessionId,
    // the restart finalizes it with close_reason 'restart', then segment 2 gets
    // a '#2' suffixed identity and its own fresh once-guard.
    const seg1 = createDeepgramLiveCostFinalizer(session())
    expect((await seg1('restart').done).recorded).toBe(true)
    const seg2 = createDeepgramLiveCostFinalizer(session({ sessionId: 'abc123def456#2' }))
    expect((await seg2('ws_close').done).recorded).toBe(true)

    expect(recordMock).toHaveBeenCalledTimes(2)
    const [first, second] = recordMock.mock.calls.map((c) => c[0])
    expect(first.metadata.close_reason).toBe('restart')
    expect(first.idempotency_key).toBe('deepgram:live:abc123def456')
    expect(second.idempotency_key).toBe('deepgram:live:abc123def456#2')
  })
})

describe('recordDeepgramLiveTranscriptionUsage — duration & metadata safety', () => {
  it('computes wall-clock minutes and the deepgram per-minute estimate', async () => {
    await recordDeepgramLiveTranscriptionUsage({
      userId: 'u',
      sessionId: 's1',
      startedAtMs: T0,
      endedAtMs: T0 + 120_000,
      frameCount: 100,
      finalCount: 1,
    })
    const event = recordMock.mock.calls[0][0]
    expect(event.quantity).toBe(2)
    // The ledger derives cost from watchPricing — 2 min × $0.0059/min.
    expect(estimateCostUsd({ provider: 'deepgram', unit: 'minutes', quantity: event.quantity })).toBe(
      round6(2 * PRICING.deepgram.minutes),
    )
    // 90 seconds → fractional minutes, round6.
    recordMock.mockClear()
    await recordDeepgramLiveTranscriptionUsage({
      sessionId: 's2',
      startedAtMs: T0,
      endedAtMs: T0 + 90_000,
      frameCount: 10,
    })
    expect(recordMock.mock.calls[0][0].quantity).toBe(1.5)
  })

  it('metadata is exactly the safe descriptors — no content, secrets, or raw data', async () => {
    await recordDeepgramLiveTranscriptionUsage({
      userId: 'user-1',
      sessionId: 'abc123def456',
      startedAtMs: T0,
      endedAtMs: T0 + 60_000,
      frameCount: 120,
      finalCount: 0,
      language: 'en-US',
      model: 'nova-3',
      closeReason: 'ws_close',
    })
    const event = recordMock.mock.calls[0][0]
    expect(event.metadata).toEqual({
      session_id: 'abc123def456',
      close_reason: 'ws_close',
      duration_source: 'wall_clock',
      chunk_count: 120,
      language: 'en-US',
      model: 'nova-3',
      has_final_transcript: false,
    })
    expect(event.recording_id).toBeNull()
    // Counts/durations are numeric; nothing textual rides along beyond the
    // short fixed descriptors above (no transcript text, audio, keys, headers).
    for (const v of Object.values(event.metadata)) {
      if (typeof v === 'string') expect(v.length).toBeLessThanOrEqual(32)
    }
    expect(typeof event.quantity).toBe('number')
  })
})
