import { createClient } from '@supabase/supabase-js'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

let adminClient = null

function getAdminClient() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return null
  if (!adminClient) {
    adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return adminClient
}

async function findAuthUserByEmail(supabase, normalizedEmail) {
  const perPage = 1000
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const match = data.users.find((user) => user.email?.trim().toLowerCase() === normalizedEmail)
    if (match) return match
    if (data.users.length < perPage) return null
  }
  throw new Error('auth_user_scan_limit_exceeded')
}

/**
 * Classify an existing Supabase Auth user for the Create Account flow.
 *
 *   registered — email is confirmed → a completed account. Create Account must
 *                stop and send the user to Sign in.
 *   pending    — an auth user exists but its email was never confirmed. The
 *                iPad's supabase.auth.signUp creates this unconfirmed user
 *                immediately, so an abandoned signup lands here; Create Account
 *                may resume/resend its verification code.
 *
 * email_confirmed_at is the authoritative signal: native signUp→verifyOtp sets
 * it on confirmation, and admin createUser({ email_confirm: true }) sets it up
 * front. confirmed_at is checked too for older Supabase payloads.
 */
export function classifyAuthUser(user) {
  const confirmed = Boolean(user?.email_confirmed_at || user?.confirmed_at)
  return confirmed ? 'registered' : 'pending'
}

export async function handleAuthCheckEmail(req, res) {
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email : ''
  const email = rawEmail.trim().toLowerCase()

  if (!email || !EMAIL_PATTERN.test(email)) {
    res.status(400).json({ error: 'invalid_email', message: 'A valid email is required.' })
    return
  }

  const supabase = getAdminClient()
  if (!supabase) {
    console.error('[auth-check-email] Supabase service-role client not configured')
    res.status(503).json({ error: 'auth_check_unavailable' })
    return
  }

  try {
    const user = await findAuthUserByEmail(supabase, email)
    // `exists` stays a plain boolean for older clients; `status` is additive so
    // current clients can tell a completed account (registered → Sign in) from
    // an abandoned, unconfirmed signup (pending → resume verification).
    const status = user ? classifyAuthUser(user) : 'available'
    res.json({ exists: Boolean(user), status })
  } catch (err) {
    console.error('[auth-check-email]', err)
    res.status(500).json({ error: 'auth_check_failed' })
  }
}
