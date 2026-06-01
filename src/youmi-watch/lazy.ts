import { lazy } from 'react'

/**
 * Lazily-loaded Youmi Watch dashboard. Kept in its own module so the dynamic
 * import / code-splitting concern lives inside the Youmi Watch folder and the
 * entry file (main.tsx) only imports a ready-made component. The dashboard's JS
 * and CSS ship in a separate async chunk, fetched only when `/admin/watch` is
 * visited — nothing here loads for normal product users.
 */
export const YoumiWatchApp = lazy(() => import('./YoumiWatchApp'))
