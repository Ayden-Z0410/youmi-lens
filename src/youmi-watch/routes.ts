/**
 * Youmi Watch internal routing primitives.
 *
 * The dashboard mounts under a single base path and switches pages with the
 * History API — it deliberately avoids pulling react-router into the codebase
 * (the main app has no router). `main.tsx` hands off to Youmi Watch whenever the
 * pathname starts with BASE_PATH.
 */

export const BASE_PATH = '/admin/watch'

export type WatchRoute = 'overview' | 'providers' | 'alerts'

export const ROUTE_PATHS: Record<WatchRoute, string> = {
  overview: BASE_PATH,
  providers: `${BASE_PATH}/providers`,
  alerts: `${BASE_PATH}/alerts`,
}

/** Map the current location pathname to a Youmi Watch route. */
export function routeFromPath(pathname: string): WatchRoute {
  const rest = pathname.slice(BASE_PATH.length).replace(/^\/+|\/+$/g, '')
  if (rest === 'providers') return 'providers'
  if (rest === 'alerts') return 'alerts'
  return 'overview'
}
