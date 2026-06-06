/**
 * useWatchPageData — fetch a Youmi Watch endpoint after AdminGate has passed,
 * with safe local fallback (Phase 4).
 *
 * • Starts from the provided local mock `fallback` so the page is never blank.
 * • Fetches on mount; exposes data / source / loading / unauthorized / refresh.
 * • On network/server error, keeps the page usable (source → 'local-fallback').
 * • On 401/403, flags `unauthorized` (the caller shows an access error rather
 *   than pretending data is available).
 * • Ignores stale/aborted responses so an unmounted or superseded request can't
 *   update state. `refresh()` re-runs the fetch (it bumps a tick the effect
 *   depends on, which also aborts any in-flight request).
 */
import { useContext, useCallback, useEffect, useRef, useState } from 'react'
import { fetchWatchEndpoint } from '../lib/watchApi'
import { handleWatchResult, type DataSource, type WatchDataState } from '../lib/watchPageState'
import { WatchGateContext } from '../watchGateContext'
import type { WatchCoverage, WatchEndpoint } from '../types/api'

export interface WatchPageData<T> {
  data: T
  source: DataSource
  coverage: WatchCoverage | null
  loading: boolean
  unauthorized: boolean
  error: string | null
  refresh: () => void
}

export function useWatchPageData<T>(endpoint: WatchEndpoint, fallback: T): WatchPageData<T> {
  // The gate escalates 401/403 (sign-in / Access denied). Held in a ref so the
  // fetch effect reads the latest value without re-running on identity changes.
  const gate = useContext(WatchGateContext)
  const gateRef = useRef(gate)
  useEffect(() => {
    gateRef.current = gate
  }, [gate])

  const [state, setState] = useState<WatchDataState<T>>({
    data: fallback,
    source: 'local-fallback',
    coverage: null,
    unauthorized: false,
    error: null,
  })
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const reqIdRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    const controller = new AbortController()
    const id = ++reqIdRef.current
    void (async () => {
      const result = await fetchWatchEndpoint<T>(endpoint, controller.signal)
      // Ignore stale (superseded) or post-unmount/aborted results.
      if (!mountedRef.current || id !== reqIdRef.current || controller.signal.aborted) return
      // On 401/403, escalate to the gate (unmounts the dashboard) instead of
      // applying any fallback data. Otherwise apply the result.
      const { escalated } = handleWatchResult<T>(result, gateRef.current, setState)
      if (!escalated) setLoading(false)
    })()
    return () => {
      mountedRef.current = false
      controller.abort()
    }
  }, [endpoint, tick])

  const refresh = useCallback(() => {
    setLoading(true)
    setTick((t) => t + 1)
  }, [])

  return {
    data: state.data,
    source: state.source,
    coverage: state.coverage,
    loading,
    unauthorized: state.unauthorized,
    error: state.error,
    refresh,
  }
}
