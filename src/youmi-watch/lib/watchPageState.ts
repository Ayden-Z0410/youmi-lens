/**
 * Pure state helpers for the Youmi Watch page-data hook (Phase 4). No React, no
 * I/O — so they're trivially unit-testable. The hook glues these to fetch +
 * effects; the data-source badge uses the label/tone helpers.
 */
import type { WatchApiResult, WatchSource } from '../types/api'

/** Live/partial/mock come from the server; 'local-fallback' is the client's own mock. */
export type DataSource = WatchSource | 'local-fallback'

export interface WatchDataState<T> {
  data: T
  source: DataSource
  /** True when the endpoint returned 401/403 — surface an access error, not mock. */
  unauthorized: boolean
  error: string | null
}

/**
 * Reduce an API result into the next state. Pure.
 *   • ok            → adopt server data + its source ('live' | 'partial' | 'mock').
 *   • unauthorized  → keep current data but flag unauthorized (NOT treated as
 *                     normal mock data); source shown as local-fallback.
 *   • error         → keep current data, mark source 'local-fallback' (the page
 *                     stays usable on a network/server error — never an access
 *                     error for a network failure).
 */
export function nextWatchState<T>(
  prev: WatchDataState<T>,
  result: WatchApiResult<T>,
): WatchDataState<T> {
  if (result.status === 'ok') {
    return { data: result.data, source: result.source, unauthorized: false, error: null }
  }
  if (result.status === 'unauthorized') {
    return { data: prev.data, source: 'local-fallback', unauthorized: true, error: result.reason }
  }
  return { data: prev.data, source: 'local-fallback', unauthorized: false, error: result.error }
}

export interface BadgeInput {
  source: DataSource
  unauthorized?: boolean
  loading?: boolean
}

export type BadgeTone = 'live' | 'partial' | 'mock' | 'fallback' | 'error'

/** User-facing label. Server-mock is never labelled "Live". */
export function dataSourceLabel({ source, unauthorized }: BadgeInput): string {
  if (unauthorized) return 'Access error'
  if (source === 'live') return 'Live data'
  if (source === 'partial') return 'Partial live'
  if (source === 'mock') return 'Server mock'
  return 'Local fallback'
}

export function dataSourceTone({ source, unauthorized }: BadgeInput): BadgeTone {
  if (unauthorized) return 'error'
  if (source === 'live') return 'live'
  if (source === 'partial') return 'partial'
  if (source === 'mock') return 'mock'
  return 'fallback'
}

// ── Unauthorized escalation ─────────────────────────────────────────────────
// A 401/403 from a page endpoint must NOT be shown as data — it returns control
// to the Watch gate (sign-in form / Access denied), which unmounts the
// dashboard. Network/5xx errors are NOT escalated (they keep the page usable
// with local fallback).

/** Minimal shape of the gate the hook talks to (see WatchGateContext). */
export interface WatchGateLike {
  reportUnauthorized: (reason: 'not_signed_in' | 'forbidden') => void
}

/** Gate screen an unauthorized reason maps to. */
export type GateScreen = 'signin' | 'denied'

export function unauthorizedGateAction(reason: 'not_signed_in' | 'forbidden'): GateScreen {
  return reason === 'forbidden' ? 'denied' : 'signin'
}

/**
 * Apply an API result to the page state, or escalate an unauthorized response
 * to the gate. Pure except for the two injected side-effect callbacks (so it's
 * unit-testable without React).
 *
 *   • unauthorized + gate present → gate.reportUnauthorized(); DO NOT apply any
 *     fallback data (the gate will unmount the dashboard). Returns escalated.
 *   • everything else (ok / error / unauthorized-without-gate) → applyState via
 *     nextWatchState (network/5xx stays usable as local-fallback).
 */
export function handleWatchResult<T>(
  result: WatchApiResult<T>,
  gate: WatchGateLike | null,
  applyState: (updater: (prev: WatchDataState<T>) => WatchDataState<T>) => void,
): { escalated: boolean } {
  if (result.status === 'unauthorized' && gate) {
    gate.reportUnauthorized(result.reason)
    return { escalated: true }
  }
  applyState((prev) => nextWatchState(prev, result))
  return { escalated: false }
}
