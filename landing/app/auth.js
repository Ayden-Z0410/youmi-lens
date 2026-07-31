/**
 * Youmi Lens Website — REAL auth client (production path, no mocks).
 *
 * Uses the SAME shared account identity as Desktop and iPad:
 *   - Supabase Auth (public URL + anon key from config.js) for sessions, OAuth,
 *     email/password, and recovery-code password resets.
 *   - The shared backend signup-code endpoints for registration:
 *       POST {api}/auth/check-email
 *       POST {api}/auth/send-signup-code                    { email, username }
 *       POST {api}/auth/verify-signup-code-and-create-user  { email, username, password, code }
 *   - GET {api}/subscription/status  (Authorization: Bearer <supabase jwt>)
 *
 * NO server secret is used here. Passwords, codes, and tokens are NEVER logged.
 * When config.js is not populated, every call returns a clear "not configured"
 * result instead of throwing — the UI stays usable for review.
 *
 * Supabase JS is loaded LAZILY from a pinned ESM CDN (inside ensureClient), so a
 * CDN hiccup never breaks the page UI — auth just reports "unavailable". PRODUCTION
 * HARDENING (documented): add Subresource Integrity / vendor the module before go-live.
 */
const SUPABASE_ESM = 'https://esm.sh/@supabase/supabase-js@2.101.1'

const CFG = window.YOUMI_CONFIG || {}
const CONFIGURED = typeof CFG.isConfigured === 'function' && CFG.isConfigured()

let _client = null
let _clientPromise = null
/** Lazily load the SDK + create the client. Returns null when unconfigured or the SDK can't load. */
async function ensureClient() {
  if (!CONFIGURED) return null
  if (_client) return _client
  if (!_clientPromise) {
    _clientPromise = (async () => {
      try {
        const m = await import(/* @vite-ignore */ SUPABASE_ESM)
        return m.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        })
      } catch {
        return null // CDN unreachable — UI stays usable; auth reports unavailable
      }
    })()
  }
  _client = await _clientPromise
  return _client
}

export function isConfigured() { return CONFIGURED }
const NOT_CONFIGURED = { ok: false, code: 'not_configured', message: 'The account service isn’t configured for this environment yet.' }

function apiUrl(path) {
  const origin = String(CFG.apiBaseOrigin || '').replace(/\/$/, '')
  return `${origin}/api${path}`
}

/** Only allow same-site absolute paths as post-auth redirect targets. */
export function safePath(path, fallback = '/account/') {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return fallback
  return path
}

function absReturn(path) {
  return new URL(safePath(path), window.location.origin).toString()
}

// ── session ──────────────────────────────────────────────────────────────────
export async function getSession() {
  const c = await ensureClient(); if (!c) return null
  let { data } = await c.auth.getSession()
  if (data.session) return data.session
  // A freshly constructed Supabase client can briefly report null while its
  // persisted session is being hydrated. Header + page controllers start in
  // parallel, so give that one-time initialization a short settle window before
  // treating the visitor as signed out.
  await new Promise((resolve) => setTimeout(resolve, 120))
  ;({ data } = await c.auth.getSession())
  return data.session ?? null
}
export async function getAccessToken() {
  const s = await getSession()
  return s?.access_token ?? null
}

/**
 * The signed-in user's own username, mirroring iPad's lib/auth.tsx:
 *   1. trimmed profiles.username   2. trimmed user_metadata.username   3. null
 *
 * Reads ONLY the caller's own row: `.eq('id', user.id)`, and the database
 * additionally enforces it via RLS policy `profiles_select_own` (auth.uid() = id).
 * There is no public username lookup and no new endpoint — the existing session
 * client is sufficient. A failed or missing profile read is never fatal: it falls
 * back to metadata, and the caller falls back to the email local-part. A username
 * is never fabricated — absence returns null.
 */
export async function getUsername() {
  const s = await getSession()
  if (!s?.user) return null
  const meta = typeof s.user.user_metadata?.username === 'string' ? s.user.user_metadata.username.trim() : ''
  const c = await ensureClient()
  if (!c) return meta || null
  try {
    const { data, error } = await c.from('profiles').select('username').eq('id', s.user.id).maybeSingle()
    if (error) return meta || null // profile unreadable → metadata, then legacy fallback
    const profileName = typeof data?.username === 'string' ? data.username.trim() : ''
    if (profileName) return profileName
  } catch {
    return meta || null
  }
  return meta || null
}
export async function onAuthChange(cb) {
  const c = await ensureClient(); if (!c) return () => {}
  const { data } = c.auth.onAuthStateChange((_e, session) => cb(session))
  return () => data.subscription.unsubscribe()
}

// ── sign in ──────────────────────────────────────────────────────────────────
export async function signInWithPassword(email, password) {
  const c = await ensureClient(); if (!c) return NOT_CONFIGURED
  const { error } = await c.auth.signInWithPassword({ email: email.trim(), password })
  if (error) return { ok: false, code: 'invalid_credentials', message: 'Email or password is incorrect.' }
  return { ok: true }
}

export async function signInWithProvider(provider /* 'google' | 'apple' */) {
  const c = await ensureClient(); if (!c) return NOT_CONFIGURED
  const { error } = await c.auth.signInWithOAuth({
    provider,
    options: { redirectTo: absReturn(CFG.authReturnPath || '/account/') },
  })
  // On success the browser is redirected away; error means it never left.
  if (error) return { ok: false, code: 'oauth_failed', message: 'Could not start sign-in. Please try again.' }
  return { ok: true }
}

// ── registration (shared 8-digit email code flow) ───────────────────────────
// The username is supplied explicitly by the user, exactly as on Desktop. It is
// NOT derived from the email: a fabricated value silently claimed a globally
// unique name the user never chose. Callers pass an already-trimmed value that
// passed validateUsername() from profileFields.js.

export async function checkEmail(email) {
  if (!CONFIGURED) return NOT_CONFIGURED
  try {
    const res = await fetch(apiUrl('/auth/check-email'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    })
    const body = await res.json().catch(() => ({}))
    return { ok: true, exists: Boolean(body.exists), status: body.status || null }
  } catch {
    return { ok: false, code: 'network_error', message: 'Network error. Please try again.' }
  }
}

async function postAuth(path, payload) {
  if (!CONFIGURED) return NOT_CONFIGURED
  try {
    const res = await fetch(apiUrl(path), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await res.json().catch(() => ({}))
    if (res.ok && body.ok === true) return { ok: true }
    return { ok: false, code: body.error || `http_${res.status}`, message: body.message || 'Something went wrong. Please try again.' }
  } catch {
    return { ok: false, code: 'network_error', message: 'Network error. Please try again.' }
  }
}

export async function sendSignupCode(email, username) {
  return postAuth('/auth/send-signup-code', { email: email.trim(), username: String(username ?? '').trim() })
}

export async function verifySignupCodeAndCreateUser(email, password, code, username) {
  const trimmedEmail = email.trim()
  const verify = await postAuth('/auth/verify-signup-code-and-create-user', {
    email: trimmedEmail, username: String(username ?? '').trim(), password, code: code.replace(/\s/g, ''),
  })
  if (!verify.ok) return verify
  // Backend never returns a session — establish it with email+password.
  const signedIn = await signInWithPassword(trimmedEmail, password)
  if (!signedIn.ok) {
    // Account already exists at this point. Do not surface a generic
    // "invalid credentials" on the verify step — the code is consumed and a
    // retry cannot recreate the user.
    return {
      ok: false,
      code: 'account_created_sign_in_required',
      message: 'Account created. Please sign in with your email and password.',
    }
  }
  return { ok: true }
}

// ── password reset — SHARED CODE flow (identical to iPad + Desktop) ───────────
// iPad lib/auth.tsx: resetPasswordForEmail(email) → verifyOtp({type:'recovery'}) → updateUser.
// Desktop AuthProvider exposes the same verifyPasswordResetCode (verifyOtp recovery).
// NO redirectTo → Supabase emails the recovery OTP the user types here.
export async function sendPasswordResetCode(email) {
  const c = await ensureClient(); if (!c) return NOT_CONFIGURED
  const { error } = await c.auth.resetPasswordForEmail(email.trim())
  // Enumeration-safe: treat "user not found" as success from the UI's view.
  if (error && !/not\s*found/i.test(error.message || '')) {
    return { ok: false, code: 'reset_failed', message: 'Could not send the reset email. Please try again.' }
  }
  return { ok: true }
}
export async function verifyPasswordResetCode(email, code) {
  const c = await ensureClient(); if (!c) return NOT_CONFIGURED
  const { error } = await c.auth.verifyOtp({ email: email.trim(), token: code.replace(/\s/g, ''), type: 'recovery' })
  if (error) return { ok: false, code: 'invalid_code', message: 'That code didn’t work or has expired. Request a new one.' }
  return { ok: true } // recovery session is now active → updatePassword()
}

export async function updatePassword(newPassword) {
  const c = await ensureClient(); if (!c) return NOT_CONFIGURED
  const { error } = await c.auth.updateUser({ password: newPassword })
  if (error) return { ok: false, code: 'update_failed', message: 'Could not update your password. The reset code or recovery session may have expired.' }
  return { ok: true }
}

// ── sign out ─────────────────────────────────────────────────────────────────
export async function signOut() {
  const c = await ensureClient(); if (!c) return { ok: true }
  await c.auth.signOut()
  return { ok: true }
}

// ── account / subscription status (Bearer) ──────────────────────────────────
async function authedGet(path) {
  if (!CONFIGURED) return { ok: false, code: 'not_configured' }
  const token = await getAccessToken()
  if (!token) return { ok: false, code: 'auth_required' }
  try {
    const res = await fetch(apiUrl(path), {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 401) return { ok: false, code: 'auth_required' }
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, code: body.error || `http_${res.status}`, message: body.message }
    return { ok: true, body }
  } catch {
    return { ok: false, code: 'network_error', message: 'Couldn’t load your account. Please try again.' }
  }
}

export function getSubscriptionStatus() { return authedGet('/subscription/status') }
export function getQuotaStatus() { return authedGet('/quota/status') }

// ── billing (existing production endpoints; NO new Stripe logic) ─────────────
async function authedPost(path, payload) {
  if (!CONFIGURED) return { ok: false, code: 'not_configured', message: 'Billing isn’t configured in this environment.' }
  const token = await getAccessToken()
  if (!token) return { ok: false, code: 'auth_required', message: 'Please sign in first.' }
  try {
    const res = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload || {}),
    })
    const body = await res.json().catch(() => ({}))
    const safeUrl = safeStripeUrl(body.url)
    if (res.ok && body.ok && safeUrl) return { ok: true, url: safeUrl }
    return { ok: false, code: body.error || `http_${res.status}`, message: body.message || 'Billing is temporarily unavailable.' }
  } catch {
    return { ok: false, code: 'network_error', message: 'Network error. Please try again.' }
  }
}
function safeStripeUrl(raw) {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && ['checkout.stripe.com', 'billing.stripe.com'].includes(url.hostname)
      ? url.toString()
      : null
  } catch {
    return null
  }
}
/** Start Stripe Checkout for a plan_code (e.g. student_basic_monthly). Redirects on success. */
export function startCheckout(planCode) { return authedPost('/billing/checkout', { plan_code: planCode }) }
/** Open the Stripe billing portal. Redirects on success. */
export function openBillingPortal() { return authedPost('/billing/portal', {}) }
