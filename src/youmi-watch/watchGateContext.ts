import { createContext } from 'react'

/**
 * Lets components inside the authorized Youmi Watch dashboard (e.g. the header
 * sign-out button) ask the gate to return to the sign-in form, without prop
 * drilling. The gate flips the UI immediately and signs out in the background,
 * so the form appears instantly regardless of network/auth-revoke latency.
 */
export interface WatchGateContextValue {
  signOut: () => void
  /**
   * Escalate an unauthorized page-endpoint response back to the gate:
   * 'not_signed_in' (401) → sign-in form, 'forbidden' (403) → Access denied.
   * The dashboard is unmounted; the data is never shown as mock/fallback.
   */
  reportUnauthorized: (reason: 'not_signed_in' | 'forbidden') => void
}

export const WatchGateContext = createContext<WatchGateContextValue | null>(null)
