import { afterEach, describe, expect, it, vi } from 'vitest'
import { BillingApiError, type SubscriptionRecord } from '../lib/billing/billingClient'
import { createBillingController } from './useBilling'

function emptySub(over: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    provider: null,
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('createBillingController / useBilling behavior', () => {
  it('initial signed-out state', () => {
    const c = createBillingController()
    c.setAuthLoading(false)
    c.setSignedIn(false)
    expect(c.getSnapshot().state.status).toBe('signed_out')
    c.dispose()
  })

  it('successful load', async () => {
    const getSubscriptionStatus = vi.fn(async () => ({
      ok: true as const,
      subscription: emptySub({
        provider: 'stripe',
        active: true,
        status: 'active',
        planCode: 'student_basic_monthly',
        billingInterval: 'month',
        manageable: true,
      }),
    }))
    const getQuotaStatus = vi.fn(async () => ({
      ok: true as const,
      plan: {
        unlimited: false,
        monthlyMinutesLimit: 600,
        maxRecordingsPerDay: 6,
        maxProcessingJobsPerDay: 10,
      },
    }))
    const c = createBillingController({ getSubscriptionStatus, getQuotaStatus })
    c.setAuthLoading(false)
    c.setSignedIn(true)
    await c.load()
    expect(c.getSnapshot().state.status).toBe('active')
    expect(getSubscriptionStatus).toHaveBeenCalledOnce()
    expect(getQuotaStatus).toHaveBeenCalledOnce()
    c.dispose()
  })

  it('refresh calls refresh endpoint then authoritative reload', async () => {
    const refreshSubscription = vi.fn(async () => ({
      ok: true as const,
      refreshed: true,
      subscription: emptySub({ active: false, status: 'none' }),
    }))
    const getSubscriptionStatus = vi.fn(async () => ({
      ok: true as const,
      subscription: emptySub({
        provider: 'stripe',
        active: true,
        status: 'active',
        planCode: 'student_basic_monthly',
        billingInterval: 'month',
        manageable: true,
      }),
    }))
    const getQuotaStatus = vi.fn(async () => ({
      ok: true as const,
      plan: { unlimited: false, monthlyMinutesLimit: 600 },
    }))
    const c = createBillingController({ refreshSubscription, getSubscriptionStatus, getQuotaStatus })
    c.setAuthLoading(false)
    c.setSignedIn(true)
    await c.refresh()
    expect(refreshSubscription).toHaveBeenCalledOnce()
    expect(getSubscriptionStatus).toHaveBeenCalledOnce()
    expect(getQuotaStatus).toHaveBeenCalledOnce()
    expect(c.getSnapshot().state.status).toBe('active')
    c.dispose()
  })

  it('monthly and annual upgrade open backend Checkout URLs only', async () => {
    const createCheckout = vi.fn(async (plan: string) => ({
      ok: true as const,
      url: `https://checkout.stripe.com/${plan}`,
    }))
    const openExternalUrl = vi.fn(async () => {})
    const c = createBillingController({ createCheckout, openExternalUrl })
    c.setAuthLoading(false)
    c.setSignedIn(true)
    await c.upgrade('student_basic_monthly')
    await c.upgrade('student_basic_annual')
    expect(createCheckout).toHaveBeenCalledWith('student_basic_monthly')
    expect(createCheckout).toHaveBeenCalledWith('student_basic_annual')
    expect(openExternalUrl).toHaveBeenCalledWith('https://checkout.stripe.com/student_basic_monthly')
    expect(openExternalUrl).toHaveBeenCalledWith('https://checkout.stripe.com/student_basic_annual')
    // Upgrade must not invent an active entitlement without an authoritative load.
    expect(c.getSnapshot().state.status).not.toBe('active')
    c.dispose()
  })

  it('duplicate upgrade clicks open one Checkout only', async () => {
    const gate = deferred<{ ok: true; url: string }>()
    const createCheckout = vi.fn(() => gate.promise)
    const openExternalUrl = vi.fn(async () => {})
    const c = createBillingController({ createCheckout, openExternalUrl })
    c.setAuthLoading(false)
    c.setSignedIn(true)
    const p1 = c.upgrade('student_basic_monthly')
    const p2 = c.upgrade('student_basic_monthly')
    gate.resolve({ ok: true, url: 'https://checkout.stripe.com/once' })
    await Promise.all([p1, p2])
    expect(createCheckout).toHaveBeenCalledOnce()
    expect(openExternalUrl).toHaveBeenCalledOnce()
    c.dispose()
  })

  it('manage opens backend Portal URL; duplicate clicks open once', async () => {
    const gate = deferred<{ ok: true; url: string }>()
    const openPortal = vi.fn(() => gate.promise)
    const openExternalUrl = vi.fn(async () => {})
    const c = createBillingController({ openPortal, openExternalUrl })
    c.setAuthLoading(false)
    c.setSignedIn(true)
    const p1 = c.manage()
    const p2 = c.manage()
    gate.resolve({ ok: true, url: 'https://billing.stripe.com/portal' })
    await Promise.all([p1, p2])
    expect(openPortal).toHaveBeenCalledOnce()
    expect(openExternalUrl).toHaveBeenCalledWith('https://billing.stripe.com/portal')
    c.dispose()
  })

  it('action failure does not activate subscription', async () => {
    const getSubscriptionStatus = vi.fn(async () => ({
      ok: true as const,
      subscription: emptySub({ status: 'none' }),
    }))
    const getQuotaStatus = vi.fn(async () => ({ ok: true as const, plan: { unlimited: false } }))
    const createCheckout = vi.fn(async () => {
      throw new BillingApiError('http', 'Could not start checkout.', { status: 502, code: 'checkout_failed' })
    })
    const c = createBillingController({ getSubscriptionStatus, getQuotaStatus, createCheckout })
    c.setAuthLoading(false)
    c.setSignedIn(true)
    await c.load()
    expect(c.getSnapshot().state.status).toBe('free')
    await expect(c.upgrade('student_basic_monthly')).rejects.toMatchObject({
      code: 'checkout_failed',
    })
    expect(c.getSnapshot().state.status).toBe('free')
    expect(c.getSnapshot().error?.code).toBe('checkout_failed')
    c.dispose()
  })

  it('unmount / dispose ignores late resolutions', async () => {
    const gate = deferred<{
      ok: true
      subscription: SubscriptionRecord
    }>()
    const getSubscriptionStatus = vi.fn(() => gate.promise)
    const getQuotaStatus = vi.fn(async () => ({ ok: true as const, plan: { unlimited: false } }))
    const c = createBillingController({ getSubscriptionStatus, getQuotaStatus })
    c.setAuthLoading(false)
    c.setSignedIn(true)
    const pending = c.load()
    c.dispose()
    gate.resolve({
      ok: true,
      subscription: emptySub({
        active: true,
        status: 'active',
        planCode: 'student_basic_monthly',
        billingInterval: 'month',
      }),
    })
    await pending
    // Disposed controller must not publish active state to listeners (none remain).
    expect(c.getSnapshot().state.status).not.toBe('active')
  })

  it('session sign-out clears billing to signed_out', async () => {
    const getSubscriptionStatus = vi.fn(async () => ({
      ok: true as const,
      subscription: emptySub({
        active: true,
        status: 'active',
        planCode: 'student_basic_monthly',
        billingInterval: 'month',
        manageable: true,
      }),
    }))
    const getQuotaStatus = vi.fn(async () => ({ ok: true as const, plan: { unlimited: false } }))
    const c = createBillingController({ getSubscriptionStatus, getQuotaStatus })
    c.setAuthLoading(false)
    c.setSignedIn(true)
    await c.load()
    expect(c.getSnapshot().state.status).toBe('active')
    c.setSignedIn(false)
    expect(c.getSnapshot().state.status).toBe('signed_out')
    c.dispose()
  })
})
