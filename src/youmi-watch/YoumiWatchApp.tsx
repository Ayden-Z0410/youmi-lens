/**
 * YoumiWatchApp — root of the internal Youmi Watch developer dashboard.
 *
 * Mounted by main.tsx when the pathname is under `/admin/watch`. Owns the
 * lightweight History-API routing between Overview and Providers (no
 * react-router; see routes.ts) and frames the active page in YoumiWatchLayout.
 *
 * SECURITY: this is an internal admin surface. For now it is gated only by the
 * separate `/admin/watch` route and renders mock data with no backend calls —
 * there is nothing sensitive here yet. Before wiring real APIs, this must be
 * placed behind a proper admin auth check (verified server-side, e.g. an
 * admin-only role on the Supabase session). See `AdminGate` below.
 */
import { useCallback, useEffect, useState } from 'react'
import { YoumiWatchLayout } from './components/YoumiWatchLayout'
import { OverviewPage } from './pages/OverviewPage'
import { ProvidersPage } from './pages/ProvidersPage'
import { ROUTE_PATHS, routeFromPath, type WatchRoute } from './routes'
import './youmi-watch.css'

/**
 * Placeholder admin gate. Today it always allows access (UI-only, mock data).
 * When real data lands, replace the body with a server-verified admin check and
 * render an access-denied state otherwise.
 */
function AdminGate({ children }: { children: React.ReactNode }) {
  const allowed = true
  if (!allowed) return null
  return <>{children}</>
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
    document.title = route === 'providers' ? 'Providers · Youmi Watch' : 'Youmi Watch'
  }, [route])

  const handleRefresh = useCallback(() => {
    // Mock data — nothing to refetch yet. Hook for the future API layer.
  }, [])

  return (
    <AdminGate>
      <YoumiWatchLayout active={route} onNavigate={navigate}>
        {route === 'providers' ? (
          <ProvidersPage onRefresh={handleRefresh} />
        ) : (
          <OverviewPage onRefresh={handleRefresh} />
        )}
      </YoumiWatchLayout>
    </AdminGate>
  )
}

export default YoumiWatchApp
