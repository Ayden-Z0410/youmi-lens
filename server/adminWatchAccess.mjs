/**
 * GET /api/admin/watch/access
 *
 * Server-verified admin gate for the internal Youmi Watch dashboard
 * (`/admin/watch`). Reuses the existing auth pattern (betaGate.mjs):
 *   1. Validate the Supabase JWT server-side (verifyJwt → getUser).
 *   2. Read the user's plan_type from user_quota (service-role client).
 *   3. Authorize only `admin` / `developer` tiers.
 *
 * The verdict is decided here, server-side — never trusted from the client.
 * Fails closed: any missing token, invalid token, DB error, or non-admin plan
 * returns `authorized: false`. No secrets or plan details are returned — only
 * the boolean and a coarse reason for the UI to pick a state.
 */
import { verifyJwt, getOrCreateUserQuota } from './betaGate.mjs'

/** Privileged tiers (matches the codebase's existing UNLIMITED_PLAN_TYPES). */
const ADMIN_PLAN_TYPES = new Set(['admin', 'developer'])

export async function handleAdminWatchAccess(req, res) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''

  if (!token) {
    return res.status(200).json({ ok: true, authorized: false, reason: 'not_signed_in' })
  }

  const user = await verifyJwt(token)
  if (!user) {
    // Invalid / expired token — treat as not signed in.
    return res.status(200).json({ ok: true, authorized: false, reason: 'not_signed_in' })
  }

  const quota = await getOrCreateUserQuota(user.userId, user.email)
  if (!quota) {
    // DB unavailable — fail closed.
    return res.status(200).json({ ok: true, authorized: false, reason: 'unavailable' })
  }

  const planType = quota.plan_type || 'public_trial'
  const authorized = ADMIN_PLAN_TYPES.has(planType)
  return res
    .status(200)
    .json({ ok: true, authorized, reason: authorized ? 'ok' : 'not_admin' })
}
