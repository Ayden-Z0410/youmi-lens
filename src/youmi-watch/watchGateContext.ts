import { createContext } from 'react'

/**
 * Lets components inside the authorized Youmi Watch dashboard (e.g. the header
 * sign-out button) ask the gate to return to the sign-in form, without prop
 * drilling. The gate flips the UI immediately and signs out in the background,
 * so the form appears instantly regardless of network/auth-revoke latency.
 */
export interface WatchGateContextValue {
  signOut: () => void
}

export const WatchGateContext = createContext<WatchGateContextValue | null>(null)
