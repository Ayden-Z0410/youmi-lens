/**
 * Auth error → user-facing copy. Pure, so every branch is unit-testable without a
 * Supabase client, a browser, or a running app.
 *
 * Copy is the Website's (landing/app/auth.js) wherever the Website has an opinion, so
 * Desktop and Website say the same thing for the same failure. The ONE deliberate
 * divergence is network failure on sign-in — see `mapSignInError`.
 */

/** The subset of a Supabase AuthError these mappers actually read. */
export type AuthErrorLike = {
  name?: string
  status?: number
  message?: string
}

/**
 * Did the request fail to reach Supabase at all (offline, DNS, TLS, timeout), as
 * opposed to being rejected by it?
 *
 * supabase-js exports `isAuthRetryableFetchError`, but depending on that symbol ties
 * us to it staying public. These markers are stable: the error class name, an HTTP
 * status of 0, and the platform fetch-failure strings (Chromium, Firefox, WebKit —
 * WebKit's WKWebView says "Load failed", which is what ships in the Tauri app).
 */
export function isNetworkAuthError(error: AuthErrorLike | null | undefined): boolean {
  if (!error) return false
  if (error.name === 'AuthRetryableFetchError') return true
  if (error.status === 0) return true
  const m = (error.message || '').toLowerCase()
  return (
    m.includes('failed to fetch') ||
    m.includes('network request failed') ||
    m.includes('networkerror') ||
    m.includes('load failed')
  )
}

/**
 * Email + password sign-in.
 *
 * DIVERGENCE FROM THE WEBSITE (deliberate): landing/app/auth.js maps EVERY error to
 * "Email or password is incorrect." An offline user is therefore told their password
 * is wrong and retypes it indefinitely. Supabase distinguishes transport failures, so
 * this reports them as network errors using the Website's own network copy. The
 * credential and unconfirmed-email cases are byte-identical to the Website.
 */
export function mapSignInError(error: AuthErrorLike): string {
  if (isNetworkAuthError(error)) return 'Network error. Please try again.'
  const raw = (error.message || '').toLowerCase()
  if (raw.includes('invalid login') || raw.includes('invalid credentials')) {
    return 'Email or password is incorrect.'
  }
  if (raw.includes('email not confirmed')) {
    return 'Please verify your email before signing in.'
  }
  return error.message || 'Sign-in failed. Please try again.'
}

/**
 * Recovery-code verification. The Website folds "wrong code" and "expired code" into
 * one message because Supabase does not reliably distinguish them.
 */
export function mapVerifyCodeError(error: AuthErrorLike): string {
  if (isNetworkAuthError(error)) return 'Network error. Please try again.'
  const raw = (error.message || '').toLowerCase()
  if (raw.includes('expired') || raw.includes('invalid') || raw.includes('token')) {
    return 'That code didn’t work or has expired. Request a new one.'
  }
  return error.message || 'Could not verify the code.'
}

/**
 * Sending a password-reset code.
 *
 * Enumeration-safe: "user not found" is reported to the UI as SUCCESS so the screen
 * can advance and say "if an account exists…". Every OTHER failure is surfaced, so the
 * user is never sent to a code screen to wait for a code that was never sent.
 * Matches landing/app/auth.js sendPasswordResetCode.
 *
 * @returns null when the caller should treat this as success.
 */
export function mapResetSendError(error: AuthErrorLike | null): string | null {
  if (!error) return null
  if (/not\s*found/i.test(error.message || '')) return null
  return 'Could not send the reset email. Please try again.'
}

/** Password update on an active recovery session. */
export function mapUpdatePasswordError(error: AuthErrorLike): string {
  if (isNetworkAuthError(error)) return 'Network error. Please try again.'
  return (
    error.message ||
    'Could not update your password. The reset code or recovery session may have expired.'
  )
}
