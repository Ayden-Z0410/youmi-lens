/**
 * Deep-link callback handling — which Supabase call each callback shape triggers.
 *
 * This is the code that turns `lecturecompanion://auth-callback…` into a session, so a
 * wrong branch here is an OAuth sign-in that silently does nothing. Exercised against a
 * fake Supabase client so every shape is covered without a network or a browser.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { applySessionFromSupabaseCallbackUrl, inspectAuthCallbackUrl } from './supabaseDeepLinkAuth'

const FAKE_SESSION = { access_token: 'a', refresh_token: 'r', user: { id: 'u1' } }

function makeClient(overrides: Record<string, unknown> = {}) {
  const calls: string[] = []
  const ok = (name: string) =>
    vi.fn(async () => {
      calls.push(name)
      return { data: { session: FAKE_SESSION }, error: null }
    })
  const auth = {
    exchangeCodeForSession: ok('exchangeCodeForSession'),
    setSession: ok('setSession'),
    verifyOtp: ok('verifyOtp'),
    ...overrides,
  }
  return { client: { auth } as unknown as SupabaseClient, auth, calls }
}

const SRC = { source: 'onOpenUrl' } as const

describe('OAuth callback shapes', () => {
  it('PKCE `?code=` → exchangeCodeForSession (NOT setSession)', async () => {
    const { client, auth } = makeClient()
    const r = await applySessionFromSupabaseCallbackUrl(
      client,
      'lecturecompanion://auth-callback?code=abc123',
      SRC,
    )
    expect(r.branch).toBe('exchange_code')
    expect(r.error).toBeNull()
    expect(r.session).toBeTruthy()
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('abc123')
    expect(auth.setSession).not.toHaveBeenCalled()
  })

  it('implicit `#access_token&refresh_token` → setSession (NOT exchangeCodeForSession)', async () => {
    const { client, auth } = makeClient()
    const r = await applySessionFromSupabaseCallbackUrl(
      client,
      'lecturecompanion://auth-callback#access_token=AT&refresh_token=RT&token_type=bearer',
      SRC,
    )
    expect(r.branch).toBe('set_session_implicit')
    expect(r.session).toBeTruthy()
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: 'AT', refresh_token: 'RT' })
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('`token_hash` + type → verifyOtp', async () => {
    const { client, auth } = makeClient()
    const r = await applySessionFromSupabaseCallbackUrl(
      client,
      'lecturecompanion://auth-callback?token_hash=TH&type=recovery',
      SRC,
    )
    expect(r.branch).toBe('verify_token_hash')
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'TH', type: 'recovery' })
  })

  it('`email` + `token` + type → verifyOtp', async () => {
    const { client, auth } = makeClient()
    const r = await applySessionFromSupabaseCallbackUrl(
      client,
      'lecturecompanion://auth-callback?email=a%40b.com&token=123456&type=email',
      SRC,
    )
    expect(r.branch).toBe('verify_email_token')
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'a@b.com',
      token: '123456',
      type: 'email',
    })
  })

  it('provider error short-circuits before any session call', async () => {
    const { client, auth } = makeClient()
    const r = await applySessionFromSupabaseCallbackUrl(
      client,
      'lecturecompanion://auth-callback?error=access_denied&error_description=User%20cancelled',
      SRC,
    )
    expect(r.branch).toBe('oauth_error')
    expect(r.error).toBe('User cancelled')
    expect(r.session).toBeNull()
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
    expect(auth.setSession).not.toHaveBeenCalled()
    expect(auth.verifyOtp).not.toHaveBeenCalled()
  })

  it('a callback with no usable params reports it instead of pretending to succeed', async () => {
    const { client } = makeClient()
    const r = await applySessionFromSupabaseCallbackUrl(
      client,
      'lecturecompanion://auth-callback?probe=1',
      SRC,
    )
    expect(r.branch).toBe('no_usable_params')
    expect(r.session).toBeNull()
    expect(r.error).toBeTruthy()
  })

  it('a Supabase failure is surfaced, not swallowed', async () => {
    const { client } = makeClient({
      exchangeCodeForSession: vi.fn(async () => ({
        data: { session: null },
        error: { message: 'invalid request: both auth code and code verifier should be non-empty' },
      })),
    })
    const r = await applySessionFromSupabaseCallbackUrl(
      client,
      'lecturecompanion://auth-callback?code=abc',
      SRC,
    )
    expect(r.branch).toBe('exchange_code')
    expect(r.error).toMatch(/code verifier/)
    expect(r.session).toBeNull()
  })
})

describe('parameter precedence', () => {
  it('query `code` wins over hash tokens when both are present', async () => {
    // The Railway bridge forwards search AND hash; PKCE must take priority so we do
    // not half-apply an implicit session that the code exchange would replace.
    const { client, auth } = makeClient()
    const r = await applySessionFromSupabaseCallbackUrl(
      client,
      'lecturecompanion://auth-callback?code=C1#access_token=AT&refresh_token=RT',
      SRC,
    )
    expect(r.branch).toBe('exchange_code')
    expect(auth.setSession).not.toHaveBeenCalled()
  })
})

describe('inspectAuthCallbackUrl — logging safety', () => {
  it('reports presence only, never values', () => {
    const out = inspectAuthCallbackUrl(
      'lecturecompanion://auth-callback?code=SECRET_CODE#access_token=SECRET_AT&refresh_token=SECRET_RT',
    )
    expect(out.queryHasCode).toBe(true)
    expect(out.hashHasAccessToken).toBe(true)
    expect(out.hashHasRefreshToken).toBe(true)
    const serialized = JSON.stringify(out)
    expect(serialized).not.toMatch(/SECRET_CODE|SECRET_AT|SECRET_RT/)
  })

  it('degrades safely on a malformed URL', () => {
    const out = inspectAuthCallbackUrl('not a url at all')
    expect(out.parseOk).toBe(false)
    expect(out.queryHasCode).toBe(false)
  })
})
