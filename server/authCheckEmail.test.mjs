import { describe, expect, it } from 'vitest'

import { classifyAuthUser } from './authCheckEmail.mjs'

// The Create Account flow depends on this discriminator: a confirmed email is a
// completed account (registered → route to Sign in), while an unconfirmed auth
// user is an abandoned signup (pending → resume/resend the verification code).
describe('classifyAuthUser', () => {
  it('classifies a confirmed email as registered', () => {
    expect(classifyAuthUser({ email_confirmed_at: '2026-07-03T00:00:00Z' })).toBe('registered')
  })

  it('classifies via the legacy confirmed_at field as registered', () => {
    expect(classifyAuthUser({ confirmed_at: '2026-07-03T00:00:00Z' })).toBe('registered')
  })

  it('classifies an unconfirmed auth user as pending', () => {
    expect(classifyAuthUser({ email_confirmed_at: null, confirmed_at: null })).toBe('pending')
  })

  it('treats a missing confirmation timestamp as pending', () => {
    expect(classifyAuthUser({})).toBe('pending')
  })
})
