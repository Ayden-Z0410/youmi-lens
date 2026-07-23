import { describe, expect, it } from 'vitest'
import {
  ANNUAL_SAVINGS_COPY,
  STUDENT_BASIC_ANNUAL_SAVINGS_USD,
  STUDENT_BASIC_ANNUAL_USD,
  STUDENT_BASIC_MONTHLY_USD,
  STUDENT_BASIC_TWELVE_MONTHLY_USD,
  formatCheckoutError,
} from './billingCheckoutCopy'

describe('billingCheckoutCopy', () => {
  it('keeps verified Student Basic prices and savings math', () => {
    expect(STUDENT_BASIC_MONTHLY_USD).toBe(4.99)
    expect(STUDENT_BASIC_ANNUAL_USD).toBe(49.99)
    expect(STUDENT_BASIC_TWELVE_MONTHLY_USD).toBe(59.88)
    expect(STUDENT_BASIC_ANNUAL_SAVINGS_USD).toBe(9.89)
    expect(ANNUAL_SAVINGS_COPY).toContain('$9.89')
  })

  it('never echoes raw Stripe-like identifiers', () => {
    const msg = formatCheckoutError({
      kind: 'http',
      message: 'Could not start checkout for price_123 / cus_abc',
      code: 'checkout_failed',
      status: 502,
    })
    expect(msg).toBe('We couldn’t open Checkout. Please try again.')
    expect(msg).not.toContain('price_')
    expect(msg).not.toContain('cus_')
  })
})
