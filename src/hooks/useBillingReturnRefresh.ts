/**
 * Attaches focus/visibility listeners for billing return reconciliation.
 * Lives with a stable useBilling instance (BillingPlanModalConnected) so
 * refresh still runs when the modal UI is closed.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clearPendingBillingReturn,
  invalidateBillingReturnOnSignOut,
  noteBillingAppInactive,
  noteBillingReturnRefreshAttempt,
  shouldRefreshOnAppActive,
} from '../lib/billing/billingReturnCoordinator'

export type BillingReturnRefreshFeedback =
  | { status: 'idle' }
  | { status: 'refreshing' }
  | { status: 'updated' }
  | { status: 'unchanged' }
  | { status: 'error'; message: string }

export type UseBillingReturnRefreshOptions = {
  signedIn: boolean
  refresh: () => Promise<void>
  /** Snapshot of normalized billing status before/after refresh for feedback. */
  getStatus: () => string
}

export type UseBillingReturnRefreshResult = {
  feedback: BillingReturnRefreshFeedback
  clearFeedback: () => void
}

export function useBillingReturnRefresh({
  signedIn,
  refresh,
  getStatus,
}: UseBillingReturnRefreshOptions): UseBillingReturnRefreshResult {
  const [feedback, setFeedback] = useState<BillingReturnRefreshFeedback>({ status: 'idle' })
  const refreshRef = useRef(refresh)
  const getStatusRef = useRef(getStatus)
  const signedInRef = useRef(signedIn)
  const inFlightRef = useRef(false)
  const mountedRef = useRef(true)

  refreshRef.current = refresh
  getStatusRef.current = getStatus
  signedInRef.current = signedIn

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!signedIn) {
      invalidateBillingReturnOnSignOut()
      setFeedback({ status: 'idle' })
    }
  }, [signedIn])

  const runReturnRefresh = useCallback(async () => {
    if (!signedInRef.current) {
      invalidateBillingReturnOnSignOut()
      return
    }
    if (!shouldRefreshOnAppActive()) return
    if (inFlightRef.current) return

    noteBillingReturnRefreshAttempt()
    inFlightRef.current = true
    const before = getStatusRef.current()
    if (mountedRef.current) setFeedback({ status: 'refreshing' })

    try {
      await refreshRef.current()
      if (!mountedRef.current) return
      if (!signedInRef.current) {
        invalidateBillingReturnOnSignOut()
        setFeedback({ status: 'idle' })
        return
      }
      const after = getStatusRef.current()
      setFeedback({ status: before === after ? 'unchanged' : 'updated' })
    } catch {
      if (!mountedRef.current) return
      // Pending already cleared by noteBillingReturnRefreshAttempt; allow manual retry.
      clearPendingBillingReturn()
      setFeedback({
        status: 'error',
        message: 'Could not refresh plan status. You can try again manually.',
      })
    } finally {
      inFlightRef.current = false
    }
  }, [])

  useEffect(() => {
    const onVisibility = () => {
      if (typeof document === 'undefined') return
      if (document.visibilityState === 'hidden') {
        noteBillingAppInactive()
        return
      }
      if (document.visibilityState === 'visible') {
        void runReturnRefresh()
      }
    }

    const onBlur = () => {
      noteBillingAppInactive()
    }

    const onFocus = () => {
      void runReturnRefresh()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [runReturnRefresh])

  return {
    feedback,
    clearFeedback: () => setFeedback({ status: 'idle' }),
  }
}
