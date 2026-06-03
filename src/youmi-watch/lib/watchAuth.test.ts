import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getSupabaseMock, signInMock, signOutMock } = vi.hoisted(() => {
  const signInMock = vi.fn()
  const signOutMock = vi.fn()
  const getSupabaseMock = vi.fn(() => ({
    auth: { signInWithPassword: signInMock, signOut: signOutMock },
  }))
  return { getSupabaseMock, signInMock, signOutMock }
})

vi.mock('../../lib/supabase', () => ({ getSupabase: getSupabaseMock }))

import { signInWatch, signOutWatch } from './watchAuth'

beforeEach(() => {
  getSupabaseMock.mockReturnValue({
    auth: { signInWithPassword: signInMock, signOut: signOutMock },
  })
  signInMock.mockResolvedValue({ error: null })
  signOutMock.mockResolvedValue({ error: null })
})

afterEach(() => vi.clearAllMocks())

describe('signInWatch', () => {
  it('returns no error on success', async () => {
    expect(await signInWatch('dev@example.com', 'pw')).toEqual({ error: null })
    expect(signInMock).toHaveBeenCalledWith({ email: 'dev@example.com', password: 'pw' })
  })

  it('maps invalid credentials to a clean message', async () => {
    signInMock.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } })
    expect(await signInWatch('dev@example.com', 'wrong')).toEqual({
      error: 'Incorrect email or password.',
    })
  })

  it('requires email and password before calling Supabase', async () => {
    expect(await signInWatch('', 'pw')).toEqual({ error: 'Enter your email address.' })
    expect(await signInWatch('dev@example.com', '')).toEqual({ error: 'Enter your password.' })
    expect(signInMock).not.toHaveBeenCalled()
  })

  it('errors gracefully when Supabase is not configured', async () => {
    getSupabaseMock.mockReturnValueOnce(null)
    const res = await signInWatch('dev@example.com', 'pw')
    expect(res.error).toBeTruthy()
  })
})

describe('signOutWatch', () => {
  it('calls Supabase signOut', async () => {
    await signOutWatch()
    expect(signOutMock).toHaveBeenCalled()
  })

  it('does not throw if signOut rejects', async () => {
    signOutMock.mockRejectedValueOnce(new Error('network'))
    await expect(signOutWatch()).resolves.toBeUndefined()
  })
})
