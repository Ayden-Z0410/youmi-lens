/**
 * Auth error-copy contract.
 *
 * These are the messages a user actually reads when sign-in, code entry, or password
 * reset fails, so each branch is pinned — including the ones the Website gets wrong
 * (network failure reported as bad credentials) which this desktop build deliberately
 * diverges from.
 */
import { describe, expect, it } from 'vitest'
import {
  isNetworkAuthError,
  mapResetSendError,
  mapSignInError,
  mapUpdatePasswordError,
  mapVerifyCodeError,
} from './authErrors'

describe('isNetworkAuthError', () => {
  it('detects the supabase retryable-fetch class', () => {
    expect(isNetworkAuthError({ name: 'AuthRetryableFetchError', message: 'x' })).toBe(true)
  })

  it('detects status 0 (request never left the client)', () => {
    expect(isNetworkAuthError({ status: 0, message: 'x' })).toBe(true)
  })

  it.each([
    'Failed to fetch',
    'TypeError: Failed to fetch',
    'Network request failed',
    'NetworkError when attempting to fetch resource.',
    // WebKit / WKWebView — this is the one that ships inside the Tauri app.
    'Load failed',
  ])('detects platform fetch failure %j', (message) => {
    expect(isNetworkAuthError({ message })).toBe(true)
  })

  it('does NOT treat a credential rejection as a network error', () => {
    expect(isNetworkAuthError({ status: 400, message: 'Invalid login credentials' })).toBe(false)
  })

  it('is safe on null/undefined/empty', () => {
    expect(isNetworkAuthError(null)).toBe(false)
    expect(isNetworkAuthError(undefined)).toBe(false)
    expect(isNetworkAuthError({})).toBe(false)
  })
})

describe('mapSignInError', () => {
  it('uses the Website copy for wrong credentials', () => {
    expect(mapSignInError({ status: 400, message: 'Invalid login credentials' })).toBe(
      'Email or password is incorrect.',
    )
  })

  it('uses the Website copy for an unconfirmed email', () => {
    expect(mapSignInError({ status: 400, message: 'Email not confirmed' })).toBe(
      'Please verify your email before signing in.',
    )
  })

  it('REGRESSION: offline must not be reported as a wrong password', () => {
    // The bug this guards: a user with no connection is told their password is wrong
    // and retypes it forever. Website behaviour; deliberately not copied.
    const offline = { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }
    expect(mapSignInError(offline)).toBe('Network error. Please try again.')
    expect(mapSignInError(offline)).not.toBe('Email or password is incorrect.')
  })

  it('never leaks a raw fetch failure string to the user', () => {
    expect(mapSignInError({ message: 'Load failed' })).not.toMatch(/load failed/i)
  })

  it('falls back to the server message, then a generic line', () => {
    expect(mapSignInError({ message: 'Signups not allowed' })).toBe('Signups not allowed')
    expect(mapSignInError({})).toBe('Sign-in failed. Please try again.')
  })
})

describe('mapVerifyCodeError', () => {
  it.each(['Token has expired', 'Invalid token', 'token_hash is invalid'])(
    'folds %j into the single Website message',
    (message) => {
      expect(mapVerifyCodeError({ message })).toBe(
        'That code didn’t work or has expired. Request a new one.',
      )
    },
  )

  it('separates a network failure from a bad code', () => {
    expect(mapVerifyCodeError({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' })).toBe(
      'Network error. Please try again.',
    )
  })
})

describe('mapResetSendError', () => {
  it('treats no error as success', () => {
    expect(mapResetSendError(null)).toBeNull()
  })

  it('ENUMERATION-SAFE: "user not found" is reported as success', () => {
    expect(mapResetSendError({ message: 'User not found' })).toBeNull()
    expect(mapResetSendError({ message: 'user not found' })).toBeNull()
  })

  it('REGRESSION: a real send failure must surface, not silently advance', () => {
    // The bug this guards: every error was swallowed, so an offline user was sent to
    // a code screen to wait for a code that was never sent.
    expect(mapResetSendError({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' })).toBe(
      'Could not send the reset email. Please try again.',
    )
    expect(mapResetSendError({ status: 429, message: 'Email rate limit exceeded' })).toBe(
      'Could not send the reset email. Please try again.',
    )
  })
})

describe('mapUpdatePasswordError', () => {
  it('separates network failure from an expired recovery session', () => {
    expect(mapUpdatePasswordError({ name: 'AuthRetryableFetchError', message: 'Load failed' })).toBe(
      'Network error. Please try again.',
    )
  })

  it('falls back to the Website copy when the server says nothing useful', () => {
    expect(mapUpdatePasswordError({})).toBe(
      'Could not update your password. The reset code or recovery session may have expired.',
    )
  })
})
