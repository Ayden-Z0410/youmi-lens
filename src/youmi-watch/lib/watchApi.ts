/**
 * Youmi Watch — shared API client (Phase 4).
 *
 * Single place that fetches the internal /api/admin/watch/* read endpoints.
 * Reads the current Supabase access token and sends it as a Bearer header. The
 * token is never returned, logged, or stored anywhere. Returns a typed,
 * discriminated result so callers can distinguish live vs server-mock vs
 * unauthorized vs network/server error — and never have to touch fetch/auth
 * logic themselves.
 *
 * The frontend NEVER queries the watch_* Supabase tables directly; all real
 * reads go through these endpoints.
 */
import { getSupabase } from '../../lib/supabase'
import { getAiApiBase } from '../../lib/ai/apiBase'
import type { WatchApiResult, WatchEndpoint } from '../types/api'

export async function fetchWatchEndpoint<T>(
  endpoint: WatchEndpoint,
  signal?: AbortSignal,
): Promise<WatchApiResult<T>> {
  const supabase = getSupabase()
  if (!supabase) return { status: 'error', error: 'not_configured' }

  let token: string | undefined
  try {
    const { data } = await supabase.auth.getSession()
    token = data.session?.access_token ?? undefined
  } catch {
    return { status: 'error', error: 'session_error' }
  }
  // No session token → treat as unauthorized (the gate will handle re-auth).
  if (!token) return { status: 'unauthorized', reason: 'not_signed_in' }

  let res: Response
  try {
    res = await fetch(`${getAiApiBase()}/admin/watch/${endpoint}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal,
    })
  } catch {
    // Network failure / aborted / API base misconfigured.
    return { status: 'error', error: 'network' }
  }

  if (res.status === 401) return { status: 'unauthorized', reason: 'not_signed_in' }
  if (res.status === 403) return { status: 'unauthorized', reason: 'forbidden' }
  if (!res.ok) return { status: 'error', error: `http_${res.status}` }

  let json: unknown
  try {
    json = await res.json()
  } catch {
    return { status: 'error', error: 'parse' }
  }

  // Defensive top-level validation — don't blindly trust the server JSON.
  if (!json || typeof json !== 'object') return { status: 'error', error: 'bad_shape' }
  const env = json as { ok?: unknown; source?: unknown }
  if (env.ok !== true) return { status: 'error', error: 'not_ok' }

  const source = env.source === 'live' || env.source === 'partial' ? env.source : 'mock'
  return { status: 'ok', source, data: json as T }
}
