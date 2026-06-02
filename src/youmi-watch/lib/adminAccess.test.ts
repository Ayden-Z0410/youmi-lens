import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the heavy/native dependencies so the unit under test stays pure.
const { getSupabaseMock, getSessionMock } = vi.hoisted(() => {
  const getSessionMock = vi.fn()
  const getSupabaseMock = vi.fn(() => ({ auth: { getSession: getSessionMock } }))
  return { getSupabaseMock, getSessionMock }
})

vi.mock('../../lib/supabase', () => ({ getSupabase: getSupabaseMock }))
vi.mock('../../lib/ai/apiBase', () => ({ getAiApiBase: () => '/api' }))

import { checkAdminWatchAccess } from './adminAccess'

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

describe('checkAdminWatchAccess (fails closed; trusts only the server verdict)', () => {
  it('denies when Supabase is not configured (no client)', async () => {
    getSupabaseMock.mockReturnValueOnce(null)
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('must not fetch') }))
    expect(await checkAdminWatchAccess()).toBe('denied')
  })

  it('returns signed_out when there is no session token', async () => {
    getSessionMock.mockResolvedValueOnce({ data: { session: null } })
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('must not fetch') }))
    expect(await checkAdminWatchAccess()).toBe('signed_out')
  })

  it('authorizes only when the server returns authorized: true', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, authorized: true, reason: 'ok' })))
    expect(await checkAdminWatchAccess()).toBe('authorized')
  })

  it('denies when the server returns authorized: false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, authorized: false, reason: 'not_admin' })))
    expect(await checkAdminWatchAccess()).toBe('denied')
  })

  it('maps the not_signed_in reason to signed_out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, authorized: false, reason: 'not_signed_in' })))
    expect(await checkAdminWatchAccess()).toBe('signed_out')
  })

  it('fails closed (denied) on a non-OK HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'boom' }, 500)))
    expect(await checkAdminWatchAccess()).toBe('denied')
  })

  it('fails closed (denied) on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    expect(await checkAdminWatchAccess()).toBe('denied')
  })

  it('sends the bearer token to the access endpoint', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, authorized: true }))
    vi.stubGlobal('fetch', fetchMock)
    await checkAdminWatchAccess()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/watch/access',
      expect.objectContaining({
        headers: { Authorization: 'Bearer tok' },
      }),
    )
  })
})
