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
import { useCallback, useEffect, useState } from 'react'
import { YoumiWatchLayout } from './components/YoumiWatchLayout'
import { AdminGateScreen } from './components/AdminGateScreen'
import { OverviewPage } from './pages/OverviewPage'
import { ProvidersPage } from './pages/ProvidersPage'
import { AlertsPage } from './pages/AlertsPage'
import { CostsPage } from './pages/CostsPage'
import { LogsPage } from './pages/LogsPage'
import { SettingsPage } from './pages/SettingsPage'
import { checkAdminWatchAccess, type AdminAccessState } from './lib/adminAccess'
import { ROUTE_PATHS, routeFromPath, type WatchRoute } from './routes'
import './youmi-watch.css'

/**
 * Server-verified admin gate. Renders children only after the server confirms
 * the signed-in user is an admin/developer; otherwise shows a loading, sign-in,
 * or access-denied screen. Fails closed.
 */
function AdminGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AdminAccessState>('checking')

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    void checkAdminWatchAccess(controller.signal).then((next) => {
      if (!cancelled) setState(next)
    })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  if (state === 'authorized') return <>{children}</>
  return <AdminGateScreen variant={state} />
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
