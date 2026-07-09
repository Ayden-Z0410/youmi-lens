import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import { applySessionFromSupabaseCallbackUrl } from './supabaseDeepLinkAuth'

const session = { user: { id: 'user-1' } } as Session

function supabaseWithAuth(auth: Record<string, unknown>): SupabaseClient {
  return { auth } as unknown as SupabaseClient
}

describe('applySessionFromSupabaseCallbackUrl', () => {
  it('marks implicit recovery links as password-recovery sessions', async () => {
    const calls: unknown[] = []
    const supabase = supabaseWithAuth({
      setSession: async (tokens: unknown) => {
        calls.push(tokens)
        return { data: { session }, error: null }
      },
    })

    const result = await applySessionFromSupabaseCallbackUrl(
      supabase,
      'lecturecompanion://auth-callback#access_token=access&refresh_token=refresh&type=recovery',
      { source: 'onOpenUrl' },
    )

    expect(result.branch).toBe('set_session_implicit')
    expect(result.session).toBe(session)
    expect(result.isPasswordRecovery).toBe(true)
    expect(calls).toEqual([{ access_token: 'access', refresh_token: 'refresh' }])
  })

  it('marks token-hash recovery links as password-recovery sessions', async () => {
    const calls: unknown[] = []
    const supabase = supabaseWithAuth({
      verifyOtp: async (params: unknown) => {
        calls.push(params)
        return { data: { session }, error: null }
      },
    })

    const result = await applySessionFromSupabaseCallbackUrl(
      supabase,
      'lecturecompanion://auth-callback?token_hash=hash&type=recovery',
      { source: 'getCurrent' },
    )

    expect(result.branch).toBe('verify_token_hash')
    expect(result.session).toBe(session)
    expect(result.isPasswordRecovery).toBe(true)
    expect(calls).toEqual([{ token_hash: 'hash', type: 'recovery' }])
  })

  it('does not mark non-recovery auth callbacks as password recovery', async () => {
    const supabase = supabaseWithAuth({
      verifyOtp: async () => ({ data: { session }, error: null }),
    })

    const result = await applySessionFromSupabaseCallbackUrl(
      supabase,
      'lecturecompanion://auth-callback?token_hash=hash&type=magiclink',
      { source: 'webLocation' },
    )

    expect(result.branch).toBe('verify_token_hash')
    expect(result.session).toBe(session)
    expect(result.isPasswordRecovery).toBe(false)
  })

  it('does not mark failed recovery callbacks as password recovery', async () => {
    const supabase = supabaseWithAuth({
      verifyOtp: async () => ({ data: { session: null }, error: new Error('expired') }),
    })

    const result = await applySessionFromSupabaseCallbackUrl(
      supabase,
      'lecturecompanion://auth-callback?token_hash=hash&type=recovery',
      { source: 'webLocation' },
    )

    expect(result.branch).toBe('verify_token_hash')
    expect(result.session).toBeNull()
    expect(result.isPasswordRecovery).toBe(false)
  })
})
