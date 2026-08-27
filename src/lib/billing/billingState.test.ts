import { describe, expect, it } from 'vitest'
import { BillingApiError, type QuotaStatusPayload, type SubscriptionRecord } from './billingClient'
import { deriveBillingState, normalizeBillingInterval, normalizeQuota } from './billingState'

function sub(over: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    provider: 'stripe',
    active: false,
    planCode: null,
    billingInterval: null,
    status: 'none',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    graceUntil: null,
    manageable: false,
    ...over,
  }
}

const studentQuota: QuotaStatusPayload = {
  planType: 'student_pass',
  effectivePlanType: 'student_pass',
  studentPassActive: false,
  entitlement: { active: false },
  unlimited: false,
  monthlyMinutesLimit: 600,
  minutesUsed: 12,
  minutesRemaining: 588,
  maxRecordingsPerDay: 6,
  recordingsUsedToday: 1,
  recordingsRemainingToday: 5,
  maxProcessingJobsPerDay: 10,
}

const activeStudentQuota: QuotaStatusPayload = {
  ...studentQuota,
  studentPassActive: true,
  entitlement: { active: true, planType: 'student_pass' },
}

describe('normalizeBillingInterval', () => {
  it('maps month/monthly/year/annual and unknown → null', () => {
    expect(normalizeBillingInterval('month')).toBe('monthly')
    expect(normalizeBillingInterval('monthly')).toBe('monthly')
    expect(normalizeBillingInterval('year')).toBe('annual')
    expect(normalizeBillingInterval('annual')).toBe('annual')
    expect(normalizeBillingInterval('week')).toBe(null)
    expect(normalizeBillingInterval(null)).toBe(null)
  })
})

describe('normalizeQuota', () => {
  it('maps 600 / 6 / 10 and leaves Study Tasks usage null', () => {
    const q = normalizeQuota(studentQuota)
    expect(q).toEqual({
      monthlyMinutesLimit: 600,
      minutesUsed: 12,
      minutesRemaining: 588,
      maxRecordingsPerDay: 6,
      recordingsUsedToday: 1,
      recordingsRemainingToday: 5,
      maxStudyTasksPerDay: 10,
      studyTasksUsedToday: null,
      studyTasksRemainingToday: null,
    })
  })

  it('keeps missing usage as null (never fabricates zero)', () => {
    const q = normalizeQuota({
      unlimited: false,
      monthlyMinutesLimit: 600,
      maxRecordingsPerDay: 6,
      maxProcessingJobsPerDay: 10,
    })
    expect(q.minutesUsed).toBeNull()
    expect(q.minutesRemaining).toBeNull()
    expect(q.recordingsUsedToday).toBeNull()
    expect(q.recordingsRemainingToday).toBeNull()
    expect(q.studyTasksUsedToday).toBeNull()
    expect(q.studyTasksRemainingToday).toBeNull()
  })
})

describe('deriveBillingState', () => {
  it('signed_out', () => {
    expect(deriveBillingState({ signedIn: false, loading: true, subscription: null, quota: null, error: null })).toEqual({
      status: 'signed_out',
    })
  })

  it('loading', () => {
    expect(
      deriveBillingState({ signedIn: true, loading: true, subscription: null, quota: null, error: null }).status,
    ).toBe('loading')
  })

  it('free', () => {
    const state = deriveBillingState({
      signedIn: true,
      loading: false,
      subscription: sub({ status: 'none' }),
      quota: studentQuota,
      error: null,
    })
    expect(state.status).toBe('free')
  })

  it('active monthly', () => {
    const state = deriveBillingState({
      signedIn: true,
      loading: false,
      subscription: sub({
        active: true,
        status: 'active',
        planCode: 'student_basic_monthly',
        billingInterval: 'month',
        currentPeriodEnd: '2026-08-01T00:00:00.000Z',
        manageable: true,
      }),
      quota: activeStudentQuota,
      error: null,
    })
    expect(state).toMatchObject({
      status: 'active',
      planCode: 'student_basic_monthly',
      interval: 'monthly',
      currentPeriodEnd: '2026-08-01T00:00:00.000Z',
      manageable: true,
    })
  })

  it('uses an active Apple or legacy entitlement even with no Stripe subscription', () => {
    for (const plan of [
      { ...activeStudentQuota, entitlement: { active: true, planType: 'student_pass' } },
      { ...activeStudentQuota, entitlement: { active: true, planType: 'student_pass' }, studentPassActive: true },
    ]) {
      const state = deriveBillingState({
        signedIn: true,
        loading: false,
        subscription: sub({ status: 'none', provider: null, manageable: false }),
        quota: plan,
        error: null,
      })
      expect(state).toMatchObject({ status: 'active', planCode: null, manageable: false })
    }
  })

  it('does not treat expired or revoked entitlement payloads as active', () => {
    for (const plan of [
      { ...studentQuota, studentPassActive: false, entitlement: { active: false } },
      { ...studentQuota, studentPassActive: false, entitlement: { active: true, revoked: true } },
    ]) {
      expect(
        deriveBillingState({
          signedIn: true,
          loading: false,
          subscription: sub({ status: 'none' }),
          quota: plan,
          error: null,
        }).status,
      ).toBe('free')
    }
  })

  it('active annual', () => {
    const state = deriveBillingState({
      signedIn: true,
      loading: false,
      subscription: sub({
        active: true,
        status: 'active',
        planCode: 'student_basic_annual',
        billingInterval: 'year',
        manageable: true,
      }),
      quota: activeStudentQuota,
      error: null,
    })
    expect(state).toMatchObject({ status: 'active', interval: 'annual', planCode: 'student_basic_annual' })
  })

  it('canceling with access-through date', () => {
    const state = deriveBillingState({
      signedIn: true,
      loading: false,
      subscription: sub({
        active: true,
        status: 'active',
        planCode: 'student_basic_monthly',
        billingInterval: 'month',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '2026-09-01T00:00:00.000Z',
        manageable: true,
      }),
      quota: activeStudentQuota,
      error: null,
    })
    expect(state).toMatchObject({
      status: 'canceling',
      accessThrough: '2026-09-01T00:00:00.000Z',
      manageable: true,
    })
  })

  it('past_due with active grace', () => {
    const state = deriveBillingState({
      signedIn: true,
      loading: false,
      subscription: sub({
        active: true,
        status: 'past_due',
        planCode: 'student_basic_monthly',
        billingInterval: 'month',
        currentPeriodEnd: '2026-07-01T00:00:00.000Z',
        graceUntil: '2026-07-04T00:00:00.000Z',
        manageable: true,
      }),
      quota: activeStudentQuota,
      error: null,
    })
    expect(state).toMatchObject({
      status: 'past_due',
      accessActive: true,
      graceUntil: '2026-07-04T00:00:00.000Z',
    })
  })

  it('past_due without active grace', () => {
    const state = deriveBillingState({
      signedIn: true,
      loading: false,
      subscription: sub({
        active: false,
        status: 'past_due',
        planCode: 'student_basic_monthly',
        billingInterval: 'month',
        graceUntil: '2026-07-01T00:00:00.000Z',
        manageable: true,
      }),
      quota: studentQuota,
      error: null,
    })
    expect(state).toMatchObject({ status: 'past_due', accessActive: false })
  })

  it('expired / revoked', () => {
    expect(
      deriveBillingState({
        signedIn: true,
        loading: false,
        subscription: sub({ active: false, status: 'expired', planCode: 'student_basic_monthly' }),
        quota: studentQuota,
        error: null,
      }).status,
    ).toBe('expired')
    expect(
      deriveBillingState({
        signedIn: true,
        loading: false,
        subscription: sub({ active: false, status: 'canceled', planCode: 'student_basic_annual' }),
        quota: studentQuota,
        error: null,
      }).status,
    ).toBe('expired')
  })

  it('unavailable network and configuration; never becomes free', () => {
    const network = deriveBillingState({
      signedIn: true,
      loading: false,
      subscription: null,
      quota: null,
      error: new BillingApiError('network', 'Network error', { code: 'network_error' }),
    })
    expect(network).toMatchObject({ status: 'unavailable', retryable: true, backendCode: 'network_error' })
    expect(network.status).not.toBe('free')

    const config = deriveBillingState({
      signedIn: true,
      loading: false,
      subscription: sub({ status: 'none' }),
      quota: activeStudentQuota,
      error: new BillingApiError('http', 'Billing is temporarily unavailable.', {
        status: 503,
        code: 'stripe_not_configured',
      }),
    })
    expect(config).toMatchObject({
      status: 'unavailable',
      backendCode: 'stripe_not_configured',
      retryable: true,
    })
    expect(config.status).not.toBe('free')
  })

  it('unknown interval becomes null', () => {
    const state = deriveBillingState({
      signedIn: true,
      loading: false,
      subscription: sub({
        active: true,
        status: 'active',
        planCode: 'student_basic_monthly',
        billingInterval: 'fortnight',
        manageable: true,
      }),
      quota: activeStudentQuota,
      error: null,
    })
    expect(state).toMatchObject({ status: 'active', interval: null })
  })

  it('does not infer state from checkout query params or selected plan', () => {
    const search = '?checkout=success&plan=student_basic_monthly'
    const selectedPlan = 'student_basic_annual'
    void search
    void selectedPlan
    const state = deriveBillingState({
      signedIn: true,
      loading: false,
      subscription: sub({ status: 'none' }),
      quota: { unlimited: false },
      error: null,
    })
    expect(state.status).toBe('free')
  })
})
