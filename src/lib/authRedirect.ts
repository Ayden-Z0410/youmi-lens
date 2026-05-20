import { isTauri } from '@tauri-apps/api/core'

/**
 * Custom scheme callback (production Tauri default). Must be listed in Supabase → Authentication → URL
 * Configuration → Redirect URLs, and must match `plugins.deep-link.desktop.schemes` in tauri.conf.json.
 */
export const TAURI_AUTH_CALLBACK = 'lecturecompanion://auth-callback'

/**
 * HTTP(S) path on the web origin that forwards query + hash to the custom scheme (see TauriAuthBridge).
 * Supabase redirect allow list must include the full URL, e.g. http://localhost:5173/tauri-auth-callback
 */
export const TAURI_AUTH_BRIDGE_PATH = '/tauri-auth-callback'

export function isTauriAuthBridgePathname(pathname: string): boolean {
  const normalized = pathname.replace(/\/$/, '') || '/'
  return normalized === TAURI_AUTH_BRIDGE_PATH
}

function bridgeOriginFromEnv(): string | null {
  const raw = import.meta.env.VITE_AUTH_BRIDGE_ORIGIN?.trim()
  if (!raw) return null
  return raw.replace(/\/$/, '')
}

function isTauriPackagedOrigin(origin: string): boolean {
  const normalized = origin.replace(/\/$/, '')
  return normalized === 'http://tauri.localhost' || normalized === 'https://tauri.localhost'
}

export function resolveAuthRedirectUrl({
  bridgeOrigin,
  dev,
  isTauriRuntime,
  origin,
}: {
  bridgeOrigin: string | null | undefined
  dev: boolean
  isTauriRuntime: boolean
  origin: string
}): string {
  const normalizedBridge = bridgeOrigin?.trim().replace(/\/$/, '') || null
  const desktopShell = isTauriRuntime || isTauriPackagedOrigin(origin)

  if (normalizedBridge && desktopShell) {
    return `${normalizedBridge}${TAURI_AUTH_BRIDGE_PATH}`
  }
  if (!desktopShell) {
    return origin
  }
  if (dev) {
    return `${origin}${TAURI_AUTH_BRIDGE_PATH}`
  }
  return TAURI_AUTH_CALLBACK
}

/**
 * Email magic link + OAuth `emailRedirectTo` / `redirectTo`.
 *
 * Priority order:
 * 1. Desktop shell + `VITE_AUTH_BRIDGE_ORIGIN` set → use HTTPS bridge.
 * 2. Not Tauri (pure web) → same-origin (Supabase detectSessionInUrl handles callback).
 * 3. Tauri + DEV → localhost bridge (Vite dev server serves /tauri-auth-callback).
 * 4. Tauri + PROD → custom scheme direct (lecturecompanion://auth-callback).
 *
 * A bridge origin is desktop-only. Web builds may share production env, but browser sign-in must
 * stay on the current origin so Supabase can complete the normal web callback.
 */
export function getAuthRedirectUrl(): string {
  if (typeof window === 'undefined') {
    return TAURI_AUTH_CALLBACK
  }
  return resolveAuthRedirectUrl({
    bridgeOrigin: bridgeOriginFromEnv(),
    dev: import.meta.env.DEV,
    isTauriRuntime: isTauri(),
    origin: window.location.origin,
  })
}
