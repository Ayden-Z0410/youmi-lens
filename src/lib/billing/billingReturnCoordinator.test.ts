import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BILLING_RETURN_DEDUPE_MS,
  clearPendingBillingReturn,
  getBillingReturnMarker,
  hasPendingBillingReturn,
  invalidateBillingReturnOnSignOut,
  markExternalBillingAction,
  noteBillingAppInactive,
  noteBillingReturnRefreshAttempt,
  resetBillingReturnCoordinatorForTests,
  shouldRefreshOnAppActive,
} from './billingReturnCoordinator'

afterEach(() => {
  resetBillingReturnCoordinatorForTests()
})

describe('billingReturnCoordinator', () => {
  it('has no pending marker initially', () => {
    expect(hasPendingBillingReturn()).toBe(false)
    expect(getBillingReturnMarker()).toBeNull()
    expect(shouldRefreshOnAppActive()).toBe(false)
  })

  it('successful Checkout/Portal launch creates markers', () => {
    markExternalBillingAction('checkout', 1000)
    expect(hasPendingBillingReturn()).toBe(true)
    expect(getBillingReturnMarker()).toMatchObject({
      type: 'checkout',
      launchedAt: 1000,
      pendingReturnRefresh: true,
      sawInactive: false,
    })

    markExternalBillingAction('portal', 2000)
    expect(getBillingReturnMarker()?.type).toBe('portal')
    expect(getBillingReturnMarker()?.launchedAt).toBe(2000)
  })

  it('does not refresh until app has been inactive after launch', () => {
    markExternalBillingAction('checkout', 1000)
    expect(shouldRefreshOnAppActive(1500)).toBe(false)
    noteBillingAppInactive()
    expect(shouldRefreshOnAppActive(1500)).toBe(true)
  })

  it('one refresh attempt clears pending; focus+visibility dedupe', () => {
    markExternalBillingAction('portal', 1000)
    noteBillingAppInactive()
    expect(shouldRefreshOnAppActive(1500)).toBe(true)
    noteBillingReturnRefreshAttempt(1500)
    expect(hasPendingBillingReturn()).toBe(false)
    expect(shouldRefreshOnAppActive(1500)).toBe(false)
    expect(shouldRefreshOnAppActive(1500 + BILLING_RETURN_DEDUPE_MS - 1)).toBe(false)
  })

  it('new external action allows a new refresh after prior attempt', () => {
    markExternalBillingAction('checkout', 1000)
    noteBillingAppInactive()
    noteBillingReturnRefreshAttempt(1500)
    markExternalBillingAction('portal', 3000)
    noteBillingAppInactive()
    expect(shouldRefreshOnAppActive(3000 + BILLING_RETURN_DEDUPE_MS + 1)).toBe(true)
  })

  it('blur/hidden without pending is a no-op', () => {
    noteBillingAppInactive()
    expect(getBillingReturnMarker()).toBeNull()
  })

  it('clearPending and sign-out invalidate', () => {
    markExternalBillingAction('checkout', 1000)
    noteBillingAppInactive()
    clearPendingBillingReturn()
    expect(hasPendingBillingReturn()).toBe(false)
    markExternalBillingAction('portal', 2000)
    invalidateBillingReturnOnSignOut()
    expect(getBillingReturnMarker()).toBeNull()
    expect(shouldRefreshOnAppActive(5000)).toBe(false)
  })

  it('marker is in-memory only (no storage APIs used)', () => {
    if (typeof Storage === 'undefined') {
      markExternalBillingAction('checkout', 1)
      expect(hasPendingBillingReturn()).toBe(true)
      return
    }
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    markExternalBillingAction('checkout', 1)
    noteBillingAppInactive()
    noteBillingReturnRefreshAttempt(2)
    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })
})
