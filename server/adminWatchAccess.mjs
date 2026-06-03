/**
 * Youmi Watch — server-verified admin gate (shared).
 *
 * The authorization pattern (reused from betaGate.mjs):
 *   1. Validate the Supabase JWT server-side (verifyJwt → getUser).
 *   2. Read the user's plan_type from user_quota (service-role client).
 *   3. Authorize only `admin` / `developer` tiers.
 *
 * Decided here, server-side — never trusted from the client. Fails closed: any
 * missing/invalid token, DB error, or non-admin plan is unauthorized.
 *
 * Exports:
 *   • checkWatchAdmin(req)   — pure verdict { authorized, reason, user }.
 *   • handleAdminWatchAccess(req,res) — GET /api/admin/watch/access (boolean).
 *   • requireWatchAdmin(req,res)      — guard for the read endpoints: returns
 *     the user on success, or sends 401/403 and returns null.
 */
import { verifyJwt, getOrCreateUserQuota } from './betaGate.mjs'

/** Privileged tiers (matches the codebase's existing UNLIMITED_PLAN_TYPES). */
const ADMIN_PLAN_TYPES = new Set(['admin', 'developer'])

function extractBearer(req) {
  const authHeader = req?.headers?.authorization || ''
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
}

/**
 * Server-side admin verdict for a request. Never throws.
 * @returns {Promise<{ authorized: boolean, reason: string, user: {userId:string,email:string}|null }>}
 *   reason ∈ 'ok' | 'not_signed_in' | 'unavailable' | 'not_admin'
 */
export async function checkWatchAdmin(req) {
  const token = extractBearer(req)
  if (!token) return { authorized: false, reason: 'not_signed_in', user: null }

  let user = null
  try {
    user = await verifyJwt(token)
  } catch {
    user = null
  }
  if (!user) return { authorized: false, reason: 'not_signed_in', user: null }

  let quota = null
  try {
    quota = await getOrCreateUserQuota(user.userId, user.email)
  } catch {
    quota = null
  }
  if (!quota) return { authorized: false, reason: 'unavailable', user }

  const planType = quota.plan_type || 'public_trial'
  const authorized = ADMIN_PLAN_TYPES.has(planType)
  return { authorized, reason: authorized ? 'ok' : 'not_admin', user }
}

/** GET /api/admin/watch/access — unchanged boolean contract for the gate UI. */
export async function handleAdminWatchAccess(req, res) {
  const verdict = await checkWatchAdmin(req)
  return res
    .status(200)
    .json({ ok: true, authorized: verdict.authorized, reason: verdict.reason })
}

/**
 * Guard for the Youmi Watch read endpoints. On success returns the verified
 * user; otherwise sends a 401 (not signed in) or 403 (not authorized) JSON
 * response and returns null. Callers must `return` when this returns null.
 */
export async function requireWatchAdmin(req, res) {
  const verdict = await checkWatchAdmin(req)
  if (verdict.authorized) return verdict.user

  const status = verdict.reason === 'not_signed_in' ? 401 : 403
  res.status(status).json({
    ok: false,
    error: verdict.reason === 'not_signed_in' ? 'not_signed_in' : 'forbidden',
    reason: verdict.reason,
  })
  return null
}
