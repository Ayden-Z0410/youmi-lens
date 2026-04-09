import type { Session, SupabaseClient } from '@supabase/supabase-js'

const LOG = '[lc-auth deep-link]'

/** Supabase email-link redirects may use `verifyOtp({ token_hash, type })` instead of PKCE `code`. */
const EMAIL_OTP_TYPES = new Set([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
])

function parseQueryOnly(href: string): Record<string, string> {
  const url = new URL(href)
  const result: Record<string, string> = {}
  url.searchParams.forEach((value, key) => {
    result[key] = value
  })
  return result
}

function parseHashOnly(href: string): Record<string, string> {
  const result: Record<string, string> = {}
  const url = new URL(href)
  if (url.hash && url.hash[0] === '#') {
    try {
      new URLSearchParams(url.hash.substring(1)).forEach((value, key) => {
        result[key] = value
      })
    } catch {
      /* ignore */
    }
  }
  return result
}

/**
 * Mirrors `@supabase/auth-js` `parseParametersFromURL` (not exported from the package root).
 * Collects query params and hash fragment into one map (query wins over hash).
 */
function parseParametersFromURL(href: string): Record<string, string> {
  const result: Record<string, string> = {}
  const url = new URL(href)
  if (url.hash && url.hash[0] === '#') {
    try {
      new URLSearchParams(url.hash.substring(1)).forEach((value, key) => {
        result[key] = value
      })
    } catch {
      /* ignore malformed hash */
    }
  }
  url.searchParams.forEach((value, key) => {
    result[key] = value
  })
  return result
}

/**
 * Safe for console: no token values, only presence / shape flags.
 */
export function inspectAuthCallbackUrl(href: string): {
  hrefLength: number
  hasAuthCallbackSubstring: boolean
  queryHasCode: boolean
  hashHasAccessToken: boolean
  hashHasRefreshToken: boolean
  queryHasTokenHash: boolean
  queryHasEmailAndToken: boolean
  hasOAuthErrorParams: boolean
  paramKeys: string[]
  parseOk: boolean
} {
  try {
    const q = parseQueryOnly(href)
    const h = parseHashOnly(href)
    const merged = parseParametersFromURL(href)
    return {
      hrefLength: href.length,
      hasAuthCallbackSubstring: href.includes('auth-callback'),
      queryHasCode: Boolean(q.code),
      hashHasAccessToken: Boolean(h.access_token),
      hashHasRefreshToken: Boolean(h.refresh_token),
      queryHasTokenHash: Boolean(q.token_hash ?? merged.token_hash),
      queryHasEmailAndToken: Boolean(
        (merged.email || q.email) && (merged.token || q.token) && (merged.type || q.type),
      ),
      hasOAuthErrorParams: Boolean(merged.error || merged.error_description),
      paramKeys: Object.keys(merged).sort(),
      parseOk: true,
    }
  } catch {
    return {
      hrefLength: href.length,
      hasAuthCallbackSubstring: href.includes('auth-callback'),
      queryHasCode: false,
      hashHasAccessToken: false,
      hashHasRefreshToken: false,
      queryHasTokenHash: false,
      queryHasEmailAndToken: false,
      hasOAuthErrorParams: false,
      paramKeys: [],
      parseOk: false,
    }
  }
}

export type ApplySessionBranch =
  | 'oauth_error'
  | 'exchange_code'
  | 'verify_token_hash'
  | 'verify_email_token'
  | 'set_session_implicit'
  | 'no_usable_params'
  | 'parse_error'

export type ApplySessionResult = {
  error: string | null
  branch: ApplySessionBranch
  /** Session returned by Supabase for this step (prefer over a follow-up getSession when non-null). */
  session: Session | null
}

/**
 * Completes Supabase auth from a redirect URL (magic link / OAuth) delivered via Tauri deep link.
 * Supports PKCE (`code`), email `token_hash` + `type`, `email` + `token` + `type`, and implicit hash tokens.
 */
export async function applySessionFromSupabaseCallbackUrl(
  supabase: SupabaseClient,
  callbackUrl: string,
  meta: { source: 'getCurrent' | 'onOpenUrl' | 'webLocation' },
): Promise<ApplySessionResult> {
  let params: Record<string, string>
  try {
    params = parseParametersFromURL(callbackUrl)
  } catch (e) {
    console.error(`${LOG} parseParametersFromURL threw [${meta.source}]`, e)
    return { error: 'Invalid callback URL', branch: 'parse_error', session: null }
  }

  console.info(`${LOG} applySession start [${meta.source}]`, inspectAuthCallbackUrl(callbackUrl))

  if (params.error || params.error_description) {
    console.warn(`${LOG} branch: oauth_error (not attempting session) [${meta.source}]`)
    return {
      error: params.error_description || params.error || 'Authentication failed',
      branch: 'oauth_error',
      session: null,
    }
  }

  const token_hash = params.token_hash
  const typeRaw = params.type
  if (token_hash && typeRaw && EMAIL_OTP_TYPES.has(typeRaw)) {
    console.info(`${LOG} branch: verifyOtp(token_hash) type=${typeRaw} [${meta.source}]`)
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash,
      type: typeRaw as 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email',
    })
    if (error) {
      console.error(`${LOG} verifyOtp(token_hash) FAILED`, error.message)
    } else {
      console.info(`${LOG} verifyOtp(token_hash) OK hasSession=${Boolean(data.session)}`)
    }
    return {
      error: error?.message ?? null,
      branch: 'verify_token_hash',
      session: data?.session ?? null,
    }
  }

  const email = params.email
  const token = params.token
  if (email && token && typeRaw && EMAIL_OTP_TYPES.has(typeRaw)) {
    console.info(`${LOG} branch: verifyOtp(email+token) type=${typeRaw} [${meta.source}]`)
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: typeRaw as 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email',
    })
    if (error) {
      console.error(`${LOG} verifyOtp(email+token) FAILED`, error.message)
    } else {
      console.info(`${LOG} verifyOtp(email+token) OK hasSession=${Boolean(data.session)}`)
    }
    return {
      error: error?.message ?? null,
      branch: 'verify_email_token',
      session: data?.session ?? null,
    }
  }

  if (params.code) {
    console.info(`${LOG} branch: exchangeCodeForSession (PKCE code present) [${meta.source}]`)
    const { data, error } = await supabase.auth.exchangeCodeForSession(params.code)
    if (error) {
      console.error(`${LOG} exchangeCodeForSession FAILED`, error.message)
    } else {
      console.info(`${LOG} exchangeCodeForSession OK hasSession=${Boolean(data.session)}`)
    }
    return {
      error: error?.message ?? null,
      branch: 'exchange_code',
      session: data?.session ?? null,
    }
  }

  const access_token = params.access_token
  const refresh_token = params.refresh_token
  if (access_token && refresh_token) {
    console.info(`${LOG} branch: setSession (implicit access_token + refresh_token) [${meta.source}]`)
    const { data, error } = await supabase.auth.setSession({ access_token, refresh_token })
    if (error) {
      console.error(`${LOG} setSession FAILED`, error.message)
    } else {
      console.info(`${LOG} setSession OK hasSession=${Boolean(data.session)}`)
    }
    return {
      error: error?.message ?? null,
      branch: 'set_session_implicit',
      session: data?.session ?? null,
    }
  }

  console.error(
    `${LOG} branch: no_usable_params [${meta.source}] paramKeys=${Object.keys(params).sort().join(',') || '(none)'}`,
  )
  return {
    error: 'No auth parameters found in callback URL',
    branch: 'no_usable_params',
    session: null,
  }
}
