import { describe, expect, it } from 'vitest'
import type { BillingState } from '../lib/billing/billingState'
import {
  ANNUAL_SAVINGS_COPY,
  STUDENT_BASIC_ANNUAL_SAVINGS_USD,
  STUDENT_BASIC_ANNUAL_USD,
  STUDENT_BASIC_MONTHLY_USD,
  STUDENT_BASIC_TWELVE_MONTHLY_USD,
  canOpenPortal,
  canStartCheckout,
  formatCheckoutError,
  formatPortalError,
  portalActionLabel,
} from './billingCheckoutCopy'

const emptyQuota = {
  monthlyMinutesLimit: null,
  minutesUsed: null,
  minutesRemaining: null,
  maxRecordingsPerDay: null,
  recordingsUsedToday: null,
  recordingsRemainingToday: null,
  maxStudyTasksPerDay: null,
  studyTasksUsedToday: null,
  studyTasksRemainingToday: null,
}

describe('billingCheckoutCopy', () => {
  it('keeps verified Student Basic prices and savings math', () => {
    expect(STUDENT_BASIC_MONTHLY_USD).toBe(4.99)
    expect(STUDENT_BASIC_ANNUAL_USD).toBe(49.99)
    expect(STUDENT_BASIC_TWELVE_MONTHLY_USD).toBe(59.88)
    expect(STUDENT_BASIC_ANNUAL_SAVINGS_USD).toBe(9.89)
    expect(ANNUAL_SAVINGS_COPY).toContain('$9.89')
  })

  it('never echoes raw Stripe-like identifiers in checkout errors', () => {
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

  it('maps portal errors safely without customer IDs', () => {
    expect(
      formatPortalError({ kind: 'auth', message: 'x', code: 'auth_required', status: 401 }),
    ).toBe('Please sign in again to manage your subscription.')
    expect(
      formatPortalError({
        kind: 'http',
        message: 'No billing account found. cus_secret',
        code: 'no_customer',
        status: 409,
      }),
    ).toBe('We couldn’t find a billing profile for this account.')
    expect(
      formatPortalError({
        kind: 'http',
        message: 'Billing is temporarily unavailable.',
        code: 'stripe_not_configured',
        status: 503,
      }),
    ).toBe('Subscription management is temporarily unavailable.')
    expect(
      formatPortalError({
        kind: 'http',
        message: 'Could not open the billing portal.',
        code: 'portal_failed',
        status: 502,
      }),
    ).toBe('We couldn’t open subscription management. Please try again.')
    expect(
      formatPortalError({ kind: 'network', message: 'down', code: 'network_error', status: null }),
    ).toBe('Check your connection and try again.')
    expect(
      formatPortalError({
        kind: 'malformed',
        message: 'bad',
        code: 'malformed_response',
        status: 200,
      }),
    ).toBe('Subscription management is temporarily unavailable.')
  })

  it('portal eligibility requires manageable where applicable', () => {
    const activeTrue: BillingState = {
      status: 'active',
      planCode: 'student_basic_monthly',
      interval: 'monthly',
      currentPeriodEnd: null,
      manageable: true,
      quota: emptyQuota,
    }
    const activeFalse: BillingState = { ...activeTrue, manageable: false }
    expect(canOpenPortal(activeTrue)).toBe(true)
    expect(canOpenPortal(activeFalse)).toBe(false)
    expect(canOpenPortal({ status: 'free', quota: emptyQuota })).toBe(false)
    expect(canOpenPortal({ status: 'signed_out' })).toBe(false)
    expect(canOpenPortal({ status: 'loading' })).toBe(false)
    expect(
      canOpenPortal({
        status: 'unavailable',
        reason: 'x',
        retryable: true,
      }),
    ).toBe(false)
    expect(
      canOpenPortal({
        status: 'expired',
        planCode: null,
        interval: null,
        currentPeriodEnd: null,
        manageable: true,
        quota: emptyQuota,
      }),
    ).toBe(true)
    expect(
      canOpenPortal({
        status: 'expired',
        planCode: null,
        interval: null,
        currentPeriodEnd: null,
        manageable: false,
        quota: emptyQuota,
      }),
    ).toBe(false)
    expect(canStartCheckout('free')).toBe(true)
    expect(canStartCheckout('active')).toBe(false)
  })

  it('portal action labels by state', () => {
    expect(portalActionLabel('active')).toBe('Manage subscription')
    expect(portalActionLabel('canceling')).toBe('Manage subscription')
    expect(portalActionLabel('past_due')).toBe('Resolve billing issue')
    expect(portalActionLabel('expired')).toBe('Manage billing')
  })
})
