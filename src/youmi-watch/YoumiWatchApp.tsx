/**
 * YoumiWatchApp — root of the internal Youmi Watch developer dashboard.
 *
 * Mounted by main.tsx when the pathname is under `/admin/watch`. Owns the
 * lightweight History-API routing between Overview and Providers (no
 * react-router; see routes.ts) and frames the active page in YoumiWatchLayout.
 *
 * SECURITY: this is an internal admin surface, gated by `AdminGate` below. The
 * authorization decision is made server-side (GET /api/admin/watch/access,
 * which validates the Supabase JWT and checks the user's plan_type). The client
 * only relays that verdict — it never trusts email checks or localStorage. The
 * dashboard tree does not mount until the server returns `authorized`, and the
 * gate fails closed on any error.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { YoumiWatchLayout } from './components/YoumiWatchLayout'
import { WatchGateContext } from './watchGateContext'
import {
  AccessDeniedScreen,
  GateLoading,
  WatchSignIn,
} from './components/AdminGateScreen'
import { OverviewPage } from './pages/OverviewPage'
import { ProvidersPage } from './pages/ProvidersPage'
import { AlertsPage } from './pages/AlertsPage'
import { CostsPage } from './pages/CostsPage'
import { LogsPage } from './pages/LogsPage'
import { SettingsPage } from './pages/SettingsPage'
import { checkAdminWatchAccess, type AdminAccessState } from './lib/adminAccess'
import { signInWatch, signOutWatch } from './lib/watchAuth'
import { getSupabase } from '../lib/supabase'
import { ROUTE_PATHS, routeFromPath, type WatchRoute } from './routes'
import './youmi-watch.css'

/** Gate UI states. `signin` shows the standalone Youmi Watch login form. */
type GateState = 'checking' | 'signin' | 'denied' | 'authorized'

/** Map the server access verdict to a gate UI state. */
function gateStateFor(access: AdminAccessState): GateState {
  if (access === 'authorized') return 'authorized'
  if (access === 'signed_out') return 'signin'
  return 'denied'
}

/**
 * Standalone, server-verified admin gate. Youmi Watch logs the user in directly
 * (no redirect to the main app), then verifies authorization server-side and
 * renders the dashboard only when authorized. Fails closed.
 */
function AdminGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>('checking')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Initial access check (covers the already-signed-in-and-authorized case).
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    void checkAdminWatchAccess(controller.signal).then((access) => {
      if (!cancelled) setState(gateStateFor(access))
    })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  // React to sign-out from inside the dashboard (or elsewhere): drop to the
  // Youmi Watch sign-in form rather than redirecting anywhere.
  useEffect(() => {
    const supabase = getSupabase()
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setError(null)
        setState('signin')
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const handleSignIn = useCallback(async (email: string, password: string) => {
    setSubmitting(true)
    setError(null)
    const result = await signInWatch(email, password)
    if (result.error) {
      setError(result.error)
      setSubmitting(false)
      return
    }
    // Authenticated — now verify authorization server-side.
    setSubmitting(false)
    setState('checking')
    const access = await checkAdminWatchAccess()
    setState(gateStateFor(access))
  }, [])

  const handleTryAnother = useCallback(async () => {
    await signOutWatch()
    setError(null)
    setState('signin')
  }, [])

  const handleBackToSignIn = useCallback(() => {
    setError(null)
    setState('signin')
  }, [])

  // Provided to the dashboard (header sign-out): flip to the sign-in form
  // immediately, then clear the Supabase session in the background.
  const gateValue = useMemo(
    () => ({
      signOut: () => {
        setError(null)
        setState('signin')
        void signOutWatch()
      },
    }),
    [],
  )

  if (state === 'authorized') {
    return <WatchGateContext.Provider value={gateValue}>{children}</WatchGateContext.Provider>
  }
  if (state === 'signin') {
    return <WatchSignIn onSubmit={handleSignIn} submitting={submitting} error={error} />
  }
  if (state === 'denied') {
    return (
      <AccessDeniedScreen onTryAnother={handleTryAnother} onBackToSignIn={handleBackToSignIn} />
    )
  }
  return <GateLoading />
}

export function YoumiWatchApp() {
  const [route, setRoute] = useState<WatchRoute>(() =>
    routeFromPath(window.location.pathname),
  )

  // Keep route state in sync with browser back/forward navigation.
  useEffect(() => {
    const onPop = () => setRoute(routeFromPath(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((next: WatchRoute) => {
    // Push history only when the URL actually changes. Compare against the live
    // location (not state) so the updater below stays pure — important under
    // StrictMode, which double-invokes state updaters.
    if (routeFromPath(window.location.pathname) !== next) {
      window.history.pushState({}, '', ROUTE_PATHS[next])
    }
    setRoute(next)
    document.querySelector('.yw-main__scroll')?.scrollTo({ top: 0 })
  }, [])

  // Reflect the active page in the document title.
  useEffect(() => {
    const TITLES: Partial<Record<WatchRoute, string>> = {
      providers: 'Providers',
      alerts: 'Alerts',
      costs: 'Costs',
      logs: 'Logs',
      settings: 'Settings',
    }
    const label = TITLES[route]
    document.title = label ? `${label} · Youmi Watch` : 'Youmi Watch'
  }, [route])

  const handleRefresh = useCallback(() => {
    // Mock data — nothing to refetch yet. Hook for the future API layer.
  }, [])

  return (
    <AdminGate>
      <YoumiWatchLayout active={route} onNavigate={navigate}>
        {route === 'providers' ? (
          <ProvidersPage onRefresh={handleRefresh} />
        ) : route === 'alerts' ? (
          <AlertsPage onRefresh={handleRefresh} />
        ) : route === 'costs' ? (
          <CostsPage onRefresh={handleRefresh} />
        ) : route === 'logs' ? (
          <LogsPage onRefresh={handleRefresh} />
        ) : route === 'settings' ? (
          <SettingsPage onRefresh={handleRefresh} />
        ) : (
          <OverviewPage onRefresh={handleRefresh} />
        )}
      </YoumiWatchLayout>
    </AdminGate>
  )
}

export default YoumiWatchApp
