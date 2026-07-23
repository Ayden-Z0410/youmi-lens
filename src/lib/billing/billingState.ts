/**
 * Pure normalized billing state (Commercialization V2 · Phase 2B-1).
 *
 * Derived only from auth + subscription status + quota status + loading/errors.
 * Never reads checkout query params, selected plan, or client payment flags.
 */
import type { BillingApiError, BillingPlanCode, QuotaStatusPayload, SubscriptionRecord } from './billingClient'
import { isBillingPlanCode } from './billingClient'

export type NormalizedBillingInterval = 'monthly' | 'annual'

export type NormalizedQuota = {
  monthlyMinutesLimit: number | null
  minutesUsed: number | null
  minutesRemaining: number | null
  maxRecordingsPerDay: number | null
  recordingsUsedToday: number | null
  recordingsRemainingToday: number | null
  maxStudyTasksPerDay: number | null
  studyTasksUsedToday: number | null
  studyTasksRemainingToday: number | null
}

export type BillingState =
  | { status: 'signed_out' }
  | { status: 'loading' }
  | { status: 'free'; quota: NormalizedQuota }
  | {
      status: 'active'
      planCode: BillingPlanCode | null
      interval: NormalizedBillingInterval | null
      currentPeriodEnd: string | null
      manageable: boolean
      quota: NormalizedQuota
    }
  | {
      status: 'canceling'
      planCode: BillingPlanCode | null
      interval: NormalizedBillingInterval | null
      accessThrough: string | null
      manageable: boolean
      quota: NormalizedQuota
    }
  | {
      status: 'past_due'
      planCode: BillingPlanCode | null
      interval: NormalizedBillingInterval | null
      currentPeriodEnd: string | null
      graceUntil: string | null
      accessActive: boolean
      manageable: boolean
      quota: NormalizedQuota
    }
  | {
      status: 'expired'
      planCode: BillingPlanCode | null
      interval: NormalizedBillingInterval | null
      currentPeriodEnd: string | null
      manageable: boolean
      quota: NormalizedQuota
    }
  | {
      status: 'unavailable'
      reason: string
      retryable: boolean
      backendCode?: string | null
    }

export type DeriveBillingStateInput = {
  signedIn: boolean
  loading: boolean
  subscription: SubscriptionRecord | null
  quota: QuotaStatusPayload | null
  error: BillingApiError | null | { kind?: string; message: string; code?: string | null; status?: number | null }
}

const EMPTY_QUOTA: NormalizedQuota = {
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

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

/** Backend returns `month` | `year`; also accept already-normalized aliases. */
export function normalizeBillingInterval(raw: string | null | undefined): NormalizedBillingInterval | null {
  if (raw == null) return null
  const v = String(raw).trim().toLowerCase()
  if (v === 'month' || v === 'monthly') return 'monthly'
  if (v === 'year' || v === 'annual') return 'annual'
  return null
}

export function normalizePlanCode(raw: string | null | undefined): BillingPlanCode | null {
  if (raw == null) return null
  return isBillingPlanCode(raw) ? raw : null
}

/**
 * Map real quota payload fields. Missing usage stays null (never fabricated as 0).
 * Study Tasks daily limit ← `maxProcessingJobsPerDay` when present; used/remaining
 * are not returned by the backend today.
 */
export function normalizeQuota(plan: QuotaStatusPayload | null | undefined): NormalizedQuota {
  if (!plan || plan.unlimited === true) {
    return { ...EMPTY_QUOTA }
  }
  return {
    monthlyMinutesLimit: asFiniteNumber(plan.monthlyMinutesLimit),
    minutesUsed: asFiniteNumber(plan.minutesUsed),
    minutesRemaining: asFiniteNumber(plan.minutesRemaining),
    maxRecordingsPerDay: asFiniteNumber(plan.maxRecordingsPerDay),
    recordingsUsedToday: asFiniteNumber(plan.recordingsUsedToday),
    recordingsRemainingToday: asFiniteNumber(plan.recordingsRemainingToday),
    maxStudyTasksPerDay: asFiniteNumber(plan.maxProcessingJobsPerDay),
    studyTasksUsedToday: null,
    studyTasksRemainingToday: null,
  }
}

function isTerminalInactiveStatus(status: string): boolean {
  const s = status.toLowerCase()
  return (
    s === 'canceled' ||
    s === 'cancelled' ||
    s === 'expired' ||
    s === 'revoked' ||
    s === 'unpaid' ||
    s === 'incomplete_expired'
  )
}

function unavailableFromError(
  error: NonNullable<DeriveBillingStateInput['error']>,
): Extract<BillingState, { status: 'unavailable' }> {
  const kind = 'kind' in error ? error.kind : undefined
  const code = error.code ?? null
  const retryable =
    kind === 'network' ||
    kind === 'malformed' ||
    error.status === 502 ||
    error.status === 503 ||
    code === 'network_error' ||
    code === 'subscription_status_failed' ||
    code === 'quota_required' ||
    code === 'stripe_not_configured'

  let reason = error.message || 'Billing is temporarily unavailable.'
  if (code === 'stripe_not_configured' || code === 'plan_not_configured') {
    reason = 'Billing is not configured.'
  } else if (kind === 'network' || code === 'network_error') {
    reason = 'Network error loading billing.'
  } else if (kind === 'auth' || code === 'auth_required') {
    reason = 'Sign in required to load billing.'
  }

  return {
    status: 'unavailable',
    reason,
    retryable,
    backendCode: code,
  }
}

/**
 * Precedence:
 * 1. signed_out
 * 2. loading
 * 3. unavailable / request failure
 * 4. past_due
 * 5. active + cancelAtPeriodEnd → canceling
 * 6. active
 * 7. terminal inactive/revoked/expired/canceled → expired
 * 8. no subscription → free
 */
export function deriveBillingState(input: DeriveBillingStateInput): BillingState {
  if (!input.signedIn) return { status: 'signed_out' }
  if (input.loading) return { status: 'loading' }
  if (input.error) return unavailableFromError(input.error)

  const subscription = input.subscription
  if (!subscription) {
    return unavailableFromError({
      kind: 'malformed',
      message: 'Subscription status unavailable.',
      code: 'malformed_response',
    })
  }

  const quota = normalizeQuota(input.quota)
  const planCode = normalizePlanCode(subscription.planCode)
  const interval = normalizeBillingInterval(subscription.billingInterval)
  const manageable = Boolean(subscription.manageable)

  if (subscription.status === 'past_due') {
    return {
      status: 'past_due',
      planCode,
      interval,
      currentPeriodEnd: subscription.currentPeriodEnd,
      graceUntil: subscription.graceUntil,
      accessActive: Boolean(subscription.active),
      manageable,
      quota,
    }
  }

  if (subscription.active && subscription.cancelAtPeriodEnd) {
    return {
      status: 'canceling',
      planCode,
      interval,
      accessThrough: subscription.currentPeriodEnd,
      manageable,
      quota,
    }
  }

  if (subscription.active) {
    return {
      status: 'active',
      planCode,
      interval,
      currentPeriodEnd: subscription.currentPeriodEnd,
      manageable,
      quota,
    }
  }

  if (isTerminalInactiveStatus(subscription.status)) {
    return {
      status: 'expired',
      planCode,
      interval,
      currentPeriodEnd: subscription.currentPeriodEnd,
      manageable,
      quota,
    }
  }

  // status === 'none' or any other inactive non-terminal → free
  return { status: 'free', quota }
}
