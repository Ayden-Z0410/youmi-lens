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

/**
 * Email magic link + OAuth `emailRedirectTo` / `redirectTo`.
 *
 * - **Web:** same tab origin (Supabase `detectSessionInUrl` handles hash/query).
 * - **Tauri + dev:** `http://localhost:5173/tauri-auth-callback` so the mail client opens a normal URL;
 *   that page immediately redirects to `lecturecompanion://auth-callback` with the same tokens (OS opens the app).
 * - **Tauri + prod:** `lecturecompanion://auth-callback` unless `VITE_AUTH_BRIDGE_ORIGIN` is set (HTTPS bridge for
 *   environments where a hosted redirect is required).
 */
export function getAuthRedirectUrl(): string {
  if (typeof window === 'undefined') {
    return TAURI_AUTH_CALLBACK
  }
  if (!isTauri()) {
    return window.location.origin
  }
  const envBridge = bridgeOriginFromEnv()
  if (envBridge) {
    return `${envBridge}${TAURI_AUTH_BRIDGE_PATH}`
  }
  if (import.meta.env.DEV) {
    return `${window.location.origin}${TAURI_AUTH_BRIDGE_PATH}`
  }
  return TAURI_AUTH_CALLBACK
}
