/**
 * iPad Create Profile — in-app email verification-code signup.
 *
 * Two endpoints:
 *   POST /api/auth/send-signup-code
 *     Validates email + username, rejects emails that already have an account,
 *     generates an 8-digit code, stores only its SHA-256 hash, and emails the
 *     code via Brevo. The Supabase Auth user is NOT created here.
 *
 *   POST /api/auth/verify-signup-code-and-create-user
 *     Verifies the code, and ONLY then creates the Supabase Auth user (admin
 *     API, email pre-confirmed) + upserts the profile row, then consumes the
 *     code. No session is returned — the client signs in with email+password.
 *
 * Security: codes are stored hashed (never plaintext), never logged; the
 * service-role key stays server-side; sends are throttled per email.
 */

import { createClient } from '@supabase/supabase-js'
import { randomInt, createHash } from 'node:crypto'
import { recordWatchCostEvent } from './watchLedger.mjs'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BREVO_API_KEY = process.env.BREVO_API_KEY
const BREVO_FROM_EMAIL = process.env.BREVO_FROM_EMAIL
const BREVO_FROM_NAME = process.env.BREVO_FROM_NAME || 'Youmi Lens'
const BREVO_EMAIL_ENDPOINT = 'https://api.brevo.com/v3/smtp/email'

const CODE_TTL_MS = 10 * 60 * 1000 // 10 minutes
const RESEND_COOLDOWN_MS = 30 * 1000
const MAX_SENDS_PER_HOUR = 5
const MAX_VERIFY_ATTEMPTS = 6

const EXISTING_ACCOUNT_MESSAGE =
  'This email already has a Youmi Lens account. Please sign in or use an email verification code.'

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

/**
 * Send the 8-digit verification code via the Brevo transactional email API.
 * Returns true on success. The code and API key are never logged.
 */
async function sendVerificationEmail(toEmail, code) {
  const textContent =
    `Your Youmi Lens verification code is: ${code}\n` +
    `This code expires in 10 minutes.`
  const htmlContent = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#F3F5F8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:440px;margin:0 auto;background:#FFFFFF;border-radius:14px;padding:32px;">
      <p style="margin:0 0 6px;font-size:18px;font-weight:800;color:#0A2342;">Youmi Lens</p>
      <p style="margin:0 0 20px;font-size:15px;color:#5B6472;">Your verification code</p>
      <p style="margin:0 0 20px;font-size:34px;font-weight:800;letter-spacing:8px;color:#0A2342;">${code}</p>
      <p style="margin:0;font-size:13px;color:#8B94A3;">This code expires in 10 minutes.</p>
    </div>
  </body>
</html>`

  try {
    const response = await fetch(BREVO_EMAIL_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: BREVO_FROM_NAME, email: BREVO_FROM_EMAIL },
        to: [{ email: toEmail }],
        subject: 'Your Youmi Lens verification code',
        textContent,
        htmlContent,
      }),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      console.error(
        '[send-signup-code] Brevo send failed',
        JSON.stringify({ status: response.status, detail: detail.slice(0, 300) }),
      )
      return false
    }
    return true
  } catch (err) {
    console.error('[send-signup-code] Brevo send threw', JSON.stringify({ message: err?.message || 'unknown' }))
    return false
  }
}

/**
 * Best-effort internal usage ledger write for a CONFIRMED Brevo email send.
 *
 * Appends one row to public.watch_cost_events via the shared watchLedger helper
 * (service-role, server-only). Call this ONLY after Brevo has accepted the send.
 *
 * Contract:
 *   • Never throws and never blocks the email flow — recordWatchCostEvent is
 *     itself best-effort, and this wrapper additionally guards against any
 *     unexpected throw. A failed write logs a concise warning and is dropped.
 *   • Metadata is limited to small, non-secret descriptors (purpose / template).
 *     NEVER pass the recipient address, the code, the body, tokens, or headers.
 */
async function recordBrevoEmailSend({ purpose, templateType } = {}) {
  try {
    const result = await recordWatchCostEvent({
      provider: 'brevo',
      event_type: 'email_send',
      quantity: 1,
      unit: 'emails',
      source: 'internal',
      status: 'recorded',
      user_id: null, // signup flow: no authenticated user exists yet
      recording_id: null,
      metadata: { email_purpose: purpose, template_type: templateType },
    })
    if (!result?.ok) {
      console.warn(`[send-signup-code] usage ledger write skipped: ${result?.error || 'unknown'}`)
    }
  } catch (err) {
    // Defensive: recordWatchCostEvent is best-effort, but never let a ledger
    // problem affect the email send / API response.
    console.warn(`[send-signup-code] usage ledger write threw: ${err?.message || 'unknown'}`)
  }
}

/** SHA-256 of the code salted with the email. Plaintext codes are never stored. */
function hashCode(code, email) {
  return createHash('sha256').update(`${code}:${email}`).digest('hex')
}

/** Cryptographically random 8-digit numeric code, zero-padded. */
function generateCode() {
  return String(randomInt(0, 100_000_000)).padStart(8, '0')
}

function validUsername(name) {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  return trimmed.length >= 2 && trimmed.length <= 64
}

/** Whether a Supabase Auth user already exists for this email. */
async function authUserExistsByEmail(supabase, normalizedEmail) {
  const perPage = 1000
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    if (data.users.some((user) => user.email?.trim().toLowerCase() === normalizedEmail)) {
      return true
    }
    if (data.users.length < perPage) return false
  }
  throw new Error('auth_user_scan_limit_exceeded')
}

/** POST /api/auth/send-signup-code — body: { email, username } */
export async function handleSendSignupCode(req, res) {
  const email = (typeof req.body?.email === 'string' ? req.body.email : '').trim().toLowerCase()
  const username = (typeof req.body?.username === 'string' ? req.body.username : '').trim()

  if (!email || !EMAIL_PATTERN.test(email)) {
    res.status(400).json({ ok: false, error: 'invalid_request', message: 'A valid email is required.' })
    return
  }
  if (!validUsername(username)) {
    res.status(400).json({ ok: false, error: 'invalid_request', message: 'Username must be 2–64 characters.' })
    return
  }

  const db = getAdminClient()
  if (!db) {
    console.error('[send-signup-code] Supabase service-role client not configured')
    res.status(503).json({ ok: false, error: 'unavailable', message: 'Account creation is temporarily unavailable.' })
    return
  }

  // Check for an existing Supabase Auth user BEFORE the Brevo availability check, so an
  // already-registered email always surfaces the friendly 409 (regardless of whether the
  // outbound email service is reachable).
  try {
    if (await authUserExistsByEmail(db, email)) {
      res.status(409).json({ ok: false, error: 'email_exists', message: EXISTING_ACCOUNT_MESSAGE })
      return
    }
  } catch (err) {
    console.error('[send-signup-code] existing-account check failed', err?.message)
    res.status(500).json({
      ok: false,
      error: 'check_failed',
      message: 'Could not verify whether this email is available. Please try again.',
    })
    return
  }

  if (!BREVO_API_KEY || !BREVO_FROM_EMAIL) {
    console.error('[send-signup-code] Brevo email not configured — BREVO_API_KEY/BREVO_FROM_EMAIL missing')
    res.status(503).json({ ok: false, error: 'service_unavailable', message: 'Verification email is temporarily unavailable.' })
    return
  }

  // Throttle: hourly cap + short cooldown between sends per email.
  const hourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { data: recent, error: recentErr } = await db
    .from('signup_codes')
    .select('created_at')
    .eq('email', email)
    .gte('created_at', hourAgoIso)
    .order('created_at', { ascending: false })
  if (!recentErr && recent) {
    if (recent.length >= MAX_SENDS_PER_HOUR) {
      res.status(429).json({ ok: false, error: 'rate_limited', message: 'Too many code requests. Please try again later.' })
      return
    }
    if (recent[0] && Date.now() - new Date(recent[0].created_at).getTime() < RESEND_COOLDOWN_MS) {
      res.status(429).json({
        ok: false,
        error: 'rate_limited',
        message: 'Please wait a moment before requesting another code.',
      })
      return
    }
  }

  const code = generateCode()
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString()

  // Supersede any earlier unconsumed codes so only the newest one can verify.
  await db.from('signup_codes').update({ consumed: true }).eq('email', email).eq('consumed', false)

  const { error: insertErr } = await db.from('signup_codes').insert({
    email,
    username,
    code_hash: hashCode(code, email),
    expires_at: expiresAt,
    consumed: false,
  })
  if (insertErr) {
    console.error('[send-signup-code] insert failed', insertErr.message)
    res.status(500).json({ ok: false, error: 'store_failed', message: 'Could not start account creation. Please try again.' })
    return
  }

  const emailSent = await sendVerificationEmail(email, code)
  if (!emailSent) {
    res.status(502).json({ ok: false, error: 'email_send_failed', message: 'Could not send the verification email. Please try again.' })
    return
  }

  // Email accepted by Brevo — append one internal usage event (best-effort).
  // Must not affect the response below if the ledger write fails.
  await recordBrevoEmailSend({ purpose: 'signup_verification', templateType: 'verification_code' })

  console.info('[send-signup-code] code sent', JSON.stringify({ emailDomain: email.split('@')[1] || null }))
  res.json({ ok: true })
}

/** POST /api/auth/verify-signup-code-and-create-user — body: { username, email, password, code } */
export async function handleVerifySignupCodeAndCreateUser(req, res) {
  const email = (typeof req.body?.email === 'string' ? req.body.email : '').trim().toLowerCase()
  const username = (typeof req.body?.username === 'string' ? req.body.username : '').trim()
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const code = (typeof req.body?.code === 'string' ? req.body.code : '').replace(/\s/g, '')

  if (!email || !EMAIL_PATTERN.test(email)) {
    res.status(400).json({ ok: false, error: 'invalid_request', message: 'A valid email is required.' })
    return
  }
  if (!validUsername(username)) {
    res.status(400).json({ ok: false, error: 'invalid_request', message: 'Username must be 2–64 characters.' })
    return
  }
  if (password.length < 8) {
    res.status(400).json({ ok: false, error: 'invalid_request', message: 'Password must be at least 8 characters.' })
    return
  }
  if (!/^\d{8}$/.test(code)) {
    res.status(400).json({ ok: false, error: 'invalid_code', message: 'Enter the full 8-digit code.' })
    return
  }

  const db = getAdminClient()
  if (!db) {
    res.status(503).json({ ok: false, error: 'unavailable', message: 'Account creation is temporarily unavailable.' })
    return
  }

  // Newest unconsumed code for this email.
  const { data: rows, error: selErr } = await db
    .from('signup_codes')
    .select('*')
    .eq('email', email)
    .eq('consumed', false)
    .order('created_at', { ascending: false })
    .limit(1)
  if (selErr) {
    console.error('[verify-signup-code] select failed', selErr.message)
    res.status(500).json({ ok: false, error: 'store_failed', message: 'Could not verify the code. Please try again.' })
    return
  }
  const row = rows && rows[0]
  if (!row) {
    res.status(400).json({ ok: false, error: 'invalid_code', message: 'No active verification code. Please request a new code.' })
    return
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    res.status(400).json({ ok: false, error: 'code_expired', message: 'This code has expired. Please request a new code.' })
    return
  }
  if ((row.attempts ?? 0) >= MAX_VERIFY_ATTEMPTS) {
    await db.from('signup_codes').update({ consumed: true }).eq('id', row.id)
    res.status(429).json({ ok: false, error: 'too_many_attempts', message: 'Too many incorrect attempts. Please request a new code.' })
    return
  }
  if (hashCode(code, email) !== row.code_hash) {
    await db.from('signup_codes').update({ attempts: (row.attempts ?? 0) + 1 }).eq('id', row.id)
    res.status(400).json({ ok: false, error: 'invalid_code', message: 'Incorrect code. Please check it and try again.' })
    return
  }

  // Code verified — create the Supabase Auth user now, and not before.
  try {
    if (await authUserExistsByEmail(db, email)) {
      await db.from('signup_codes').update({ consumed: true }).eq('id', row.id)
      res.status(409).json({ ok: false, error: 'email_exists', message: EXISTING_ACCOUNT_MESSAGE })
      return
    }
  } catch (err) {
    console.error('[verify-signup-code] existing-account check failed', err?.message)
    res.status(500).json({ ok: false, error: 'check_failed', message: 'Could not finish account creation. Please try again.' })
    return
  }

  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // email ownership already proven by the verified code
    user_metadata: { username },
  })
  if (createErr || !created?.user) {
    const message = String(createErr?.message || '')
    if (/already|registered|exists/i.test(message)) {
      await db.from('signup_codes').update({ consumed: true }).eq('id', row.id)
      res.status(409).json({ ok: false, error: 'email_exists', message: EXISTING_ACCOUNT_MESSAGE })
      return
    }
    console.error('[verify-signup-code] createUser failed', message)
    res.status(500).json({ ok: false, error: 'create_failed', message: 'Could not create your account. Please try again.' })
    return
  }

  // Profile row (non-fatal: loadUsername falls back to user_metadata.username).
  const { error: profileErr } = await db
    .from('profiles')
    .upsert({ id: created.user.id, username, updated_at: new Date().toISOString() })
  if (profileErr) {
    console.warn('[verify-signup-code] profile upsert failed', profileErr.message)
  }

  await db.from('signup_codes').update({ consumed: true }).eq('id', row.id)

  console.info('[verify-signup-code] account created', JSON.stringify({ userIdPrefix: created.user.id.slice(0, 8) }))
  // No session returned — the client signs in with the email + password it holds.
  res.json({ ok: true })
}
