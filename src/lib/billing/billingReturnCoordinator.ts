/**
 * In-memory billing return coordinator (Commercialization V2 · Phase 2B-6).
 *
 * Tracks that this app session successfully launched Checkout or Portal and
 * should run ONE authoritative refresh after the app becomes active again.
 *
 * Does NOT mean payment succeeded, subscription changed, or entitlement updated.
 * No localStorage / sessionStorage / URL query persistence.
 */

export type BillingExternalAction = 'checkout' | 'portal'

export type BillingReturnMarker = {
  type: BillingExternalAction
  launchedAt: number
  pendingReturnRefresh: boolean
  /** Set when the app went hidden/blurred after launch — required before auto-refresh. */
  sawInactive: boolean
}

/** Focus + visibility often fire together; suppress a second attempt in this window. */
export const BILLING_RETURN_DEDUPE_MS = 2000

let marker: BillingReturnMarker | null = null
let lastRefreshAttemptAt = 0

export function getBillingReturnMarker(): BillingReturnMarker | null {
  return marker
}

export function hasPendingBillingReturn(): boolean {
  return Boolean(marker?.pendingReturnRefresh)
}

/**
 * Call only after backend returned a URL and openExternalUrl() succeeded.
 */
export function markExternalBillingAction(
  type: BillingExternalAction,
  nowMs: number = Date.now(),
): void {
  marker = {
    type,
    launchedAt: nowMs,
    pendingReturnRefresh: true,
    sawInactive: false,
  }
}

/** App became hidden/blurred after a billing external launch. */
export function noteBillingAppInactive(): void {
  if (!marker?.pendingReturnRefresh) return
  if (marker.sawInactive) return
  marker = { ...marker, sawInactive: true }
}

/**
 * Whether an automatic refresh should run on app-active (focus / visible).
 * Requires pending marker + saw inactive + outside dedupe window.
 */
export function shouldRefreshOnAppActive(nowMs: number = Date.now()): boolean {
  if (!marker?.pendingReturnRefresh) return false
  if (!marker.sawInactive) return false
  if (lastRefreshAttemptAt > 0 && nowMs - lastRefreshAttemptAt < BILLING_RETURN_DEDUPE_MS) return false
  return true
}

/**
 * Record that an automatic return-refresh was initiated.
 * Clears pending so one launch → at most one automatic reconciliation.
 */
export function noteBillingReturnRefreshAttempt(nowMs: number = Date.now()): void {
  lastRefreshAttemptAt = nowMs
  if (!marker) return
  marker = { ...marker, pendingReturnRefresh: false }
}

export function clearPendingBillingReturn(): void {
  if (!marker) return
  marker = { ...marker, pendingReturnRefresh: false }
}

/** Sign-out / session loss invalidates any pending return refresh. */
export function invalidateBillingReturnOnSignOut(): void {
  marker = null
  lastRefreshAttemptAt = 0
}

/** Test-only reset. */
export function resetBillingReturnCoordinatorForTests(): void {
  marker = null
  lastRefreshAttemptAt = 0
}
