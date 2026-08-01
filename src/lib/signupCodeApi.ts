/**
 * Typed wrappers for the backend signup-code endpoints used by Create Account.
 * All endpoints live behind the same API base as the rest of the app (`getAiApiBase`).
 *
 * Backend routes:
 *   POST /api/auth/check-email                            — body: { email }
 *   POST /api/auth/send-signup-code                       — body: { email, username }
 *   POST /api/auth/verify-signup-code-and-create-user     — body: { email, username, password, code }
 *
 * The backend itself never returns a session — after a successful verify the caller is expected
 * to sign in via `supabase.auth.signInWithPassword`.
 *
 * These are the SAME endpoints the Website calls from landing/app/auth.js, so both
 * surfaces share one registration mechanism.
 */

import { getAiApiBase } from './ai/apiBase'

type ApiOk = { ok: true }
type ApiErr = { ok: false; error?: string; message?: string }
type ApiBody = ApiOk | ApiErr

const FALLBACK_MESSAGE = 'Something went wrong. Please try again.'

async function postJson(path: string, body: unknown): Promise<ApiBody> {
  let base: string
  try {
    base = getAiApiBase()
  } catch (e) {
    console.error('[signupCodeApi] api base unavailable', e)
    return {
      ok: false,
      error: 'api_base_unavailable',
      message: 'The account service is not available in this build.',
    }
  }

  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    let parsed: unknown = null
    try {
      parsed = await res.json()
    } catch {
      /* keep parsed null */
    }
    if (res.ok && parsed && typeof parsed === 'object' && (parsed as { ok?: boolean }).ok === true) {
      return { ok: true }
    }
    const safe = (parsed && typeof parsed === 'object' ? parsed : {}) as Partial<ApiErr>
    return {
      ok: false,
      error: typeof safe.error === 'string' ? safe.error : `http_${res.status}`,
      message: typeof safe.message === 'string' ? safe.message : FALLBACK_MESSAGE,
    }
  } catch (e) {
    console.error('[signupCodeApi] network failure', e)
    return {
      ok: false,
      error: 'network_error',
      message: 'Network error. Check your connection and try again.',
    }
  }
}

/** Stable backend error codes the UI maps to specific copy / behavior. */
export type SignupCodeBackendError =
  | 'email_exists'
  | 'invalid_request'
  | 'invalid_code'
  | 'code_expired'
  | 'too_many_attempts'
  | 'rate_limited'
  | 'service_unavailable'
  | 'unavailable'
  | 'store_failed'
  | 'check_failed'
  | 'create_failed'
  | 'server_error'
  | 'email_send_failed'
  | 'api_base_unavailable'
  | 'network_error'

export type SignupCodeResult = {
  error: string | null
  /** Stable error code from the backend (or our wrapper) when `error` is non-null. */
  code: SignupCodeBackendError | string | null
}

/** Outcome of the pre-flight email check. Mirrors `checkEmail` in landing/app/auth.js. */
export type CheckEmailResult = {
  /** False when the endpoint could not be reached or answered — callers proceed anyway. */
  ok: boolean
  exists: boolean
  /** 'registered' | 'pending' | 'available' from the backend, or null when unknown. */
  status: string | null
}

/**
 * Pre-flight: does this email already have an account?
 *
 * Advisory only. The Website treats a failed check as "keep going" and lets
 * send-signup-code be the authority (it returns `email_exists`), so a backend
 * hiccup can never block a legitimate signup. We do the same.
 *
 * The endpoint answers `{ exists, status }` WITHOUT an `ok` flag, so this cannot
 * reuse `postJson` — it inspects the raw body directly.
 */
export async function checkEmail(email: string): Promise<CheckEmailResult> {
  let base: string
  try {
    base = getAiApiBase()
  } catch {
    return { ok: false, exists: false, status: null }
  }
  try {
    const res = await fetch(`${base}/auth/check-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    })
    if (!res.ok) return { ok: false, exists: false, status: null }
    const parsed: unknown = await res.json().catch(() => null)
    const body = (parsed && typeof parsed === 'object' ? parsed : {}) as {
      exists?: unknown
      status?: unknown
    }
    return {
      ok: true,
      exists: Boolean(body.exists),
      status: typeof body.status === 'string' ? body.status : null,
    }
  } catch {
    return { ok: false, exists: false, status: null }
  }
}

export async function sendSignupCode(args: {
  email: string
  username: string
}): Promise<SignupCodeResult> {
  const result = await postJson('/auth/send-signup-code', {
    email: args.email,
    username: args.username,
  })
  if (result.ok) return { error: null, code: null }
  return { error: result.message || FALLBACK_MESSAGE, code: result.error ?? null }
}

export async function verifySignupCodeAndCreateUser(args: {
  email: string
  username: string
  password: string
  code: string
}): Promise<SignupCodeResult> {
  const result = await postJson('/auth/verify-signup-code-and-create-user', {
    email: args.email,
    username: args.username,
    password: args.password,
    code: args.code,
  })
  if (result.ok) return { error: null, code: null }
  return { error: result.message || FALLBACK_MESSAGE, code: result.error ?? null }
}
