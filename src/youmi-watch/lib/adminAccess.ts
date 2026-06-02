/**
 * Client-side caller for the server-verified Youmi Watch admin gate.
 *
 * This file contains NO authorization logic of its own — the decision is made
 * server-side by GET /api/admin/watch/access. Here we only:
 *   1. read the current Supabase access token (if any), and
 *   2. relay the server's verdict to the gate UI.
 *
 * Fails closed: no Supabase client, no token, network error, non-OK response,
 * or `authorized !== true` all resolve to a non-authorized state. We never trust
 * email checks or localStorage flags.
 */
import { getSupabase } from '../../lib/supabase'
import { getAiApiBase } from '../../lib/ai/apiBase'

export type AdminAccessState = 'checking' | 'authorized' | 'signed_out' | 'denied'

interface AccessResponse {
  ok?: boolean
  authorized?: boolean
  reason?: string
}

/**
 * Resolve the current user's access to Youmi Watch. Returns one of the terminal
 * states ('authorized' | 'signed_out' | 'denied'); 'checking' is only the
 * initial UI state and is never returned here.
 */
export async function checkAdminWatchAccess(signal?: AbortSignal): Promise<AdminAccessState> {
  const supabase = getSupabase()
  // Cloud not configured in this build → cannot verify → fail closed.
  if (!supabase) return 'denied'

  let token: string | undefined
  try {
    const { data } = await supabase.auth.getSession()
    token = data.session?.access_token ?? undefined
  } catch {
    return 'denied'
  }
  if (!token) return 'signed_out'

  try {
    const res = await fetch(`${getAiApiBase()}/admin/watch/access`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal,
    })
    if (!res.ok) return 'denied'
    const json = (await res.json()) as AccessResponse
    if (json.authorized === true) return 'authorized'
    if (json.reason === 'not_signed_in') return 'signed_out'
    return 'denied'
  } catch {
    // Network / abort / config error → fail closed.
    return 'denied'
  }
}
