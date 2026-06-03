/**
 * Sign-in / sign-out for the standalone Youmi Watch experience.
 *
 * Uses the existing shared Supabase client (same auth backend as the main app),
 * so Youmi Watch can log a user in directly on /admin/watch without sending
 * them to the main Youmi Lens UI. This module only performs *authentication*
 * (who you are). *Authorization* (whether you may use Youmi Watch) is decided
 * server-side in adminAccess.ts → /api/admin/watch/access and is never inferred
 * from the client here.
 */
import { getSupabase } from '../../lib/supabase'

export async function signInWatch(
  email: string,
  password: string,
): Promise<{ error: string | null }> {
  const supabase = getSupabase()
  if (!supabase) {
    return { error: 'Sign-in is not available in this build.' }
  }
  const trimmed = email.trim()
  if (!trimmed) return { error: 'Enter your email address.' }
  if (!password) return { error: 'Enter your password.' }

  const { error } = await supabase.auth.signInWithPassword({ email: trimmed, password })
  if (!error) return { error: null }

  const raw = (error.message || '').toLowerCase()
  if (raw.includes('invalid login') || raw.includes('invalid credentials')) {
    return { error: 'Incorrect email or password.' }
  }
  if (raw.includes('email not confirmed')) {
    return { error: 'Please verify your email before signing in.' }
  }
  return { error: error.message || 'Sign-in failed. Please try again.' }
}

export async function signOutWatch(): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return
  try {
    // `scope: 'local'` clears this client's session and emits SIGNED_OUT
    // immediately, without depending on a network revoke round-trip — so the
    // gate reliably returns to the sign-in form even if the network is slow.
    await supabase.auth.signOut({ scope: 'local' })
  } catch {
    /* ignore — the gate reacts to the SIGNED_OUT auth event regardless */
  }
}
