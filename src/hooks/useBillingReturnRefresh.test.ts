import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  markExternalBillingAction,
  resetBillingReturnCoordinatorForTests,
  shouldRefreshOnAppActive,
} from '../lib/billing/billingReturnCoordinator'

// Minimal listener harness without React — exercises the same coordinator policy
// the hook uses (inactive then active → one refresh).

describe('billing return refresh policy (lifecycle)', () => {
  beforeEach(() => {
    resetBillingReturnCoordinatorForTests()
  })

  afterEach(() => {
    resetBillingReturnCoordinatorForTests()
    vi.restoreAllMocks()
  })

  it('focus with no pending action does not refresh', async () => {
    const refresh = vi.fn(async () => {})
    if (shouldRefreshOnAppActive()) await refresh()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('hidden visibility does not refresh; visible after inactive does once', async () => {
    const refresh = vi.fn(async () => {})
    markExternalBillingAction('checkout', Date.now())

    // Simulate the hook's visibility handler path via coordinator API.
    const { noteBillingAppInactive, noteBillingReturnRefreshAttempt, shouldRefreshOnAppActive } =
      await import('../lib/billing/billingReturnCoordinator')

    // hidden
    noteBillingAppInactive()
    expect(shouldRefreshOnAppActive()).toBe(true)

    // first visible/focus
    if (shouldRefreshOnAppActive()) {
      noteBillingReturnRefreshAttempt()
      await refresh()
    }
    // second focus immediately
    if (shouldRefreshOnAppActive()) {
      noteBillingReturnRefreshAttempt()
      await refresh()
    }
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('failed URL open creates no marker when mark is not called', () => {
    // Callers only mark after openExternalUrl succeeds — absence of mark ⇒ no refresh.
    expect(shouldRefreshOnAppActive()).toBe(false)
  })

  it('Checkout then Portal replaces marker type', async () => {
    const { getBillingReturnMarker, noteBillingAppInactive } = await import(
      '../lib/billing/billingReturnCoordinator'
    )
    markExternalBillingAction('checkout', 1)
    markExternalBillingAction('portal', 2)
    noteBillingAppInactive()
    expect(getBillingReturnMarker()?.type).toBe('portal')
    expect(shouldRefreshOnAppActive(10_000)).toBe(true)
  })
})
