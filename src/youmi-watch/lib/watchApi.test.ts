import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getSupabaseMock, getSessionMock } = vi.hoisted(() => {
  const getSessionMock = vi.fn()
  const getSupabaseMock = vi.fn(() => ({ auth: { getSession: getSessionMock } }))
  return { getSupabaseMock, getSessionMock }
})

vi.mock('../../lib/supabase', () => ({ getSupabase: getSupabaseMock }))
vi.mock('../../lib/ai/apiBase', () => ({ getAiApiBase: () => '/api' }))

import { fetchWatchEndpoint } from './watchApi'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  getSupabaseMock.mockReturnValue({ auth: { getSession: getSessionMock } })
  getSessionMock.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('fetchWatchEndpoint', () => {
  it('sends the Bearer token to the right endpoint URL', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, source: 'mock', metrics: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchWatchEndpoint('overview')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/watch/overview',
      expect.objectContaining({ headers: { Authorization: 'Bearer tok' } }),
    )
  })

  it('preserves source: live', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, source: 'live', x: 1 })))
    expect(await fetchWatchEndpoint('costs')).toMatchObject({ status: 'ok', source: 'live' })
  })

  it('preserves source: mock (never upgraded to live)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, source: 'mock', x: 1 })))
    expect(await fetchWatchEndpoint('costs')).toMatchObject({ status: 'ok', source: 'mock' })
  })

  it('treats 401 and 403 as unauthorized, not as data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false }, 401)))
    expect(await fetchWatchEndpoint('logs')).toEqual({ status: 'unauthorized', reason: 'not_signed_in' })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false }, 403)))
    expect(await fetchWatchEndpoint('logs')).toEqual({ status: 'unauthorized', reason: 'forbidden' })
  })

  it('returns an error on network failure (drives local fallback)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('down')
    }))
    expect(await fetchWatchEndpoint('logs')).toEqual({ status: 'error', error: 'network' })
  })

  it('returns an error on a 5xx server response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 500)))
    expect(await fetchWatchEndpoint('overview')).toEqual({ status: 'error', error: 'http_500' })
  })

  it('returns an error when the ok flag is not true', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false, source: 'live' })))
    expect(await fetchWatchEndpoint('overview')).toEqual({ status: 'error', error: 'not_ok' })
  })

  it('returns unauthorized when there is no session token (without fetching)', async () => {
    getSessionMock.mockResolvedValueOnce({ data: { session: null } })
    const fetchMock = vi.fn(() => {
      throw new Error('must not fetch')
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchWatchEndpoint('overview')).toEqual({ status: 'unauthorized', reason: 'not_signed_in' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never exposes the access token in the result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, source: 'mock' })))
    const result = await fetchWatchEndpoint('overview')
    expect(JSON.stringify(result)).not.toContain('tok')
  })
})
