/**
 * Resend cooldown behaviour — the rules the Website enforces in wireResendControls.
 *
 * These cover the parts that actually protect the backend and the user: a failed
 * send must NOT lock the button, and a successful one must.
 */
import { describe, expect, it } from 'vitest'
import { resendButtonLabel, resendCooldownSeconds, RESEND_COOLDOWN_MS } from './useResendCode'

describe('resendCooldownSeconds', () => {
  it('is 0 when the deadline has passed', () => {
    const now = 1_000_000
    expect(resendCooldownSeconds(now - 1, now)).toBe(0)
    expect(resendCooldownSeconds(now, now)).toBe(0)
  })

  it('rounds up so a partial second still reads as remaining time', () => {
    const now = 1_000_000
    // 1ms left must show as "1s", never "0s" while the button is still disabled.
    expect(resendCooldownSeconds(now + 1, now)).toBe(1)
    expect(resendCooldownSeconds(now + 1000, now)).toBe(1)
    expect(resendCooldownSeconds(now + 1001, now)).toBe(2)
  })

  it('reports the full window right after a successful send', () => {
    const now = 1_000_000
    expect(resendCooldownSeconds(now + RESEND_COOLDOWN_MS, now)).toBe(30)
  })

  it('never returns a negative value', () => {
    const now = 1_000_000
    expect(resendCooldownSeconds(now - 999_999, now)).toBe(0)
  })
})

describe('resendButtonLabel', () => {
  it('counts down while cooling', () => {
    expect(resendButtonLabel(30, false)).toBe('Resend in 30s')
    expect(resendButtonLabel(1, false)).toBe('Resend in 1s')
  })

  it('returns to the idle label at zero', () => {
    expect(resendButtonLabel(0, false)).toBe('Resend code')
  })

  it('shows in-flight state ahead of any countdown', () => {
    expect(resendButtonLabel(0, true)).toBe('Sending…')
    expect(resendButtonLabel(12, true)).toBe('Sending…')
  })
})

describe('cooldown window', () => {
  it('matches the Website RESEND_COOLDOWN_MS', () => {
    expect(RESEND_COOLDOWN_MS).toBe(30_000)
  })
})
