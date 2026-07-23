/**
 * Student Basic plan display constants and billing action copy (Phase 2B-3 / 2B-4).
 * Prices are verified Sandbox product amounts — display only; Checkout uses plan_code.
 */
import type { BillingPlanCode } from '../lib/billing/billingClient'
import type { BillingHookError } from '../hooks/useBilling'
import type { BillingState } from '../lib/billing/billingState'

export const STUDENT_BASIC_MONTHLY_USD = 4.99
export const STUDENT_BASIC_ANNUAL_USD = 49.99
export const STUDENT_BASIC_TWELVE_MONTHLY_USD = STUDENT_BASIC_MONTHLY_USD * 12
export const STUDENT_BASIC_ANNUAL_SAVINGS_USD =
  Math.round((STUDENT_BASIC_TWELVE_MONTHLY_USD - STUDENT_BASIC_ANNUAL_USD) * 100) / 100

export const ANNUAL_SAVINGS_COPY = `Save $${STUDENT_BASIC_ANNUAL_SAVINGS_USD.toFixed(2)} compared with paying monthly for 12 months.`

export function planCodeFromInterval(interval: 'monthly' | 'annual'): BillingPlanCode {
  return interval === 'annual' ? 'student_basic_annual' : 'student_basic_monthly'
}

export function intervalFromPlanCode(planCode: BillingPlanCode): 'monthly' | 'annual' {
  return planCode === 'student_basic_annual' ? 'annual' : 'monthly'
}

/** Map upgrade/action errors to user-safe copy (no Stripe internals). */
export function formatCheckoutError(error: BillingHookError | null | undefined): string | null {
  if (!error) return null
  const code = error.code
  const kind = error.kind

  if (kind === 'auth' || code === 'auth_required') {
    return 'Please sign in again before upgrading.'
  }
  if (code === 'plan_not_configured' || code === 'stripe_not_configured') {
    return 'Checkout is temporarily unavailable.'
  }
  if (code === 'checkout_failed') {
    return 'We couldn’t open Checkout. Please try again.'
  }
  if (kind === 'network' || code === 'network_error') {
    return 'Check your connection and try again.'
  }
  if (kind === 'invalid_plan' || code === 'invalid_plan') {
    return 'Checkout is temporarily unavailable.'
  }
  if (kind === 'malformed' || code === 'malformed_response') {
    return 'We couldn’t open Checkout. Please try again.'
  }
  return 'We couldn’t open Checkout. Please try again.'
}

/** Map Portal/manage errors to user-safe copy (no customer IDs or Stripe internals). */
export function formatPortalError(error: BillingHookError | null | undefined): string | null {
  if (!error) return null
  const code = error.code
  const kind = error.kind

  if (kind === 'auth' || code === 'auth_required') {
    return 'Please sign in again to manage your subscription.'
  }
  if (code === 'no_customer') {
    return 'We couldn’t find a billing profile for this account.'
  }
  if (code === 'stripe_not_configured') {
    return 'Subscription management is temporarily unavailable.'
  }
  if (code === 'portal_failed') {
    return 'We couldn’t open subscription management. Please try again.'
  }
  if (kind === 'network' || code === 'network_error') {
    return 'Check your connection and try again.'
  }
  if (kind === 'malformed' || code === 'malformed_response') {
    return 'Subscription management is temporarily unavailable.'
  }
  return 'We couldn’t open subscription management. Please try again.'
}

export function canStartCheckout(status: string): boolean {
  return status === 'free' || status === 'expired'
}

/**
 * Portal eligibility: state category + manageable.
 * free / signed_out / loading / unavailable never qualify.
 * expired only when manageable === true (Stripe customer still mapped).
 */
export function canOpenPortal(state: BillingState): boolean {
  switch (state.status) {
    case 'active':
    case 'canceling':
    case 'past_due':
    case 'expired':
      return state.manageable === true
    default:
      return false
  }
}

export function portalActionLabel(status: BillingState['status'] | string): string {
  if (status === 'past_due') return 'Resolve billing issue'
  if (status === 'expired') return 'Manage billing'
  return 'Manage subscription'
}
