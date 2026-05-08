import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { AuthContext, type AuthContextValue } from './authContext'
import { getAuthRedirectUrl } from './lib/authRedirect'
import { getSupabase, isSupabaseConfigured } from './lib/supabase'
import {
  applySessionFromSupabaseCallbackUrl,
  inspectAuthCallbackUrl,
} from './lib/supabaseDeepLinkAuth'

/**
 * Tauri may deliver `deep-link://new-url` as a JSON array of strings, but if anything coerces it to a
 * single string, `for..of` would iterate characters and session exchange would never run.
 */
function normalizeDeepLinkUrls(payload: unknown): string[] {
  if (payload == null) return []
  if (typeof payload === 'string') {
    return payload.includes('://') ? [payload] : []
  }
  if (Array.isArray(payload)) {
    return payload
      .map((x) => (typeof x === 'string' ? x : String(x)))
      .filter((s) => s.includes('://'))
  }
  console.warn('[lc-auth deep-link] unexpected payload shape', typeof payload)
  return []
}

function summarizeDeepLinkPayloadForLog(payload: unknown): {
  typeofPayload: string
  isArray: boolean
  arrayLength: number
  normalizedUrlCount: number
} {
  const normalized = normalizeDeepLinkUrls(payload)
  return {
    typeofPayload: typeof payload,
    isArray: Array.isArray(payload),
    arrayLength: Array.isArray(payload) ? payload.length : 0,
    normalizedUrlCount: normalized.length,
  }
}

/** Same-process safety: if anything created extra webviews, drop them after auth via deep link. */
async function tauriCloseNonMainWebviewWindows(): Promise<void> {
  if (!isTauri()) return
  try {
    const { getAllWebviewWindows } = await import('@tauri-apps/api/webviewWindow')
    const wins = await getAllWebviewWindows()
    await Promise.all(
      wins.filter((w) => w.label !== 'main').map((w) => w.close()),
    )
  } catch (e) {
    console.warn('[lc-auth] close non-main webview windows failed', e)
  }
}

function scrollAppChromeToTop(): void {
  try {
    window.scrollTo(0, 0)
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
    document.getElementById('root')?.scrollTo(0, 0)
  } catch {
    /* ignore */
  }
}

/** Desktop fallback after session is written: scroll reset + webview focus (Rust already activates the app). */
async function afterDeepLinkAuthSucceededUiPolish(): Promise<void> {
  await tauriCloseNonMainWebviewWindows()
  requestAnimationFrame(() => scrollAppChromeToTop())
  if (!isTauri()) return
  try {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    await getCurrentWebviewWindow().setFocus()
  } catch (e) {
    console.warn('[lc-auth] webview setFocus failed', e)
  }
}

function userForLog(s: Session | null): { id: string | null; email: string | null } {
  return {
    id: s?.user?.id ?? null,
    email: s?.user?.email ?? null,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured()
  const supabase = getSupabase()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(configured)
  const [deepLinkAuthError, setDeepLinkAuthError] = useState<string | null>(null)

  /**
   * Single bootstrap: subscribe first, then (Tauri) apply any pending deep-link auth before
   * the first getSession(). Magic-link params live on the app deep-link scheme, not window.location,
   * so Supabase URL detection never sees them; we end loading only after startup deep links run.
   */
  useEffect(() => {
    if (!supabase || !configured) return

    let cancelled = false

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      console.info('[Auth] onAuthStateChange event:', event, { hasSession: Boolean(next) })
      if (!cancelled) setSession(next)
    })

    void (async () => {
      let sessionFromCallback: Session | null = null

      if (!isTauri() && typeof window !== 'undefined') {
        const inspect = inspectAuthCallbackUrl(window.location.href)
        const looksLikeAuthCallback =
          inspect.queryHasCode ||
          inspect.queryHasTokenHash ||
          inspect.hashHasAccessToken ||
          inspect.hashHasRefreshToken ||
          inspect.queryHasEmailAndToken
        if (looksLikeAuthCallback) {
          const { data: beforeData } = await supabase.auth.getSession()
          console.info('[lc-auth web-callback] detected in window.location', {
            inspect,
            beforeUser: userForLog(beforeData.session),
          })
          const applied = await applySessionFromSupabaseCallbackUrl(supabase, window.location.href, {
            source: 'webLocation',
          })
          if (applied.session) {
            sessionFromCallback = applied.session
            if (!cancelled) setSession(applied.session)
          }
          const { data: afterData } = await supabase.auth.getSession()
          console.info('[lc-auth web-callback] apply result', {
            branch: applied.branch,
            error: applied.error,
            hasReturnedSession: Boolean(applied.session),
            afterUser: userForLog(afterData.session),
          })
          if (!applied.error) {
            try {
              // Remove auth params so refresh won't re-run callback handling.
              window.history.replaceState({}, document.title, window.location.pathname)
            } catch {
              /* ignore */
            }
          }
        }
      }

      if (isTauri()) {
        try {
          const start = await getCurrent()
          const urls = normalizeDeepLinkUrls(start)
          if (urls.length) {
            console.info('[lc-auth deep-link] getCurrent', summarizeDeepLinkPayloadForLog(start), {
              urls: urls.map((u) => inspectAuthCallbackUrl(u)),
            })
            let anyOk = false
            for (const url of urls) {
              const _cb = inspectAuthCallbackUrl(url)
              console.info('[Auth] callback received:', {
                code: _cb.queryHasCode,
                access_token: _cb.hashHasAccessToken,
                refresh_token: _cb.hashHasRefreshToken,
              })
              const { data: beforeData } = await supabase.auth.getSession()
              console.info('[lc-auth deep-link] getCurrent before apply', userForLog(beforeData.session))
              const applied = await applySessionFromSupabaseCallbackUrl(supabase, url, {
                source: 'getCurrent',
              })
              console.info('[lc-auth deep-link] getCurrent apply result', {
                branch: applied.branch,
                error: applied.error,
                hasReturnedSession: Boolean(applied.session),
                returnedUser: userForLog(applied.session),
              })
              if (!applied.error) {
                anyOk = true
                if (applied.session) {
                  sessionFromCallback = applied.session
                  setSession(applied.session)
                  console.info('[Auth] setSession success: hasSession=true')
                }
              } else {
                console.error('[Auth] setSession failure:', applied.error, { branch: applied.branch })
              }
            }
            if (anyOk) await afterDeepLinkAuthSucceededUiPolish()
          }
        } catch (e) {
          console.warn('[lc-auth deep-link] getCurrent failed', e)
        }
      }

      const { data } = await supabase.auth.getSession()
      const finalSession = sessionFromCallback ?? data.session
      if (!cancelled) {
        setSession(finalSession)
        console.info('[Auth] startup getSession result:', {
          hasSession: Boolean(finalSession),
        })
        console.info('[lc-auth bootstrap] getSession after deep-link pass', {
          hasSession: Boolean(finalSession),
          finalUser: userForLog(finalSession),
        })
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [supabase, configured])

  /** Runtime deep links (e.g. app already open). Sync session after exchange. */
  useEffect(() => {
    if (!supabase || !configured || !isTauri()) return
    let unlisten: (() => void) | undefined

    void (async () => {
      try {
        unlisten = await onOpenUrl((payload) => {
          void (async () => {
            const urls = normalizeDeepLinkUrls(payload)
            console.info('[lc-auth deep-link] onOpenUrl received', summarizeDeepLinkPayloadForLog(payload), {
              urls: urls.map((u) => inspectAuthCallbackUrl(u)),
            })
            if (urls.length === 0) {
              console.warn('[lc-auth deep-link] onOpenUrl: no valid URLs after normalize; auth step skipped')
            }
            let anyOk = false
            for (const url of urls) {
              const _cb = inspectAuthCallbackUrl(url)
              console.info('[Auth] callback received:', {
                code: _cb.queryHasCode,
                access_token: _cb.hashHasAccessToken,
                refresh_token: _cb.hashHasRefreshToken,
              })
              const { data: beforeData } = await supabase.auth.getSession()
              console.info('[lc-auth deep-link] onOpenUrl before apply', userForLog(beforeData.session))
              const applied = await applySessionFromSupabaseCallbackUrl(supabase, url, {
                source: 'onOpenUrl',
              })
              console.info('[lc-auth deep-link] onOpenUrl apply result', {
                branch: applied.branch,
                error: applied.error,
                hasReturnedSession: Boolean(applied.session),
                returnedUser: userForLog(applied.session),
              })
              if (!applied.error) {
                anyOk = true
                if (applied.session) {
                  setSession(applied.session)
                  setDeepLinkAuthError(null)
                  console.info('[Auth] setSession success: hasSession=true')
                }
              } else {
                console.error('[Auth] setSession failure:', applied.error, { branch: applied.branch })
                console.error('[lc-auth deep-link] onOpenUrl apply failed', applied.error)
                setDeepLinkAuthError(
                  'Sign-in link expired or already used. Please request a new sign-in link.',
                )
              }
            }
            const { data } = await supabase.auth.getSession()
            setSession(data.session)
            console.info('[lc-auth deep-link] onOpenUrl getSession()', {
              hasSession: Boolean(data.session),
              finalUser: userForLog(data.session),
            })
            if (anyOk) await afterDeepLinkAuthSucceededUiPolish()
          })()
        })
      } catch (e) {
        console.warn(
          '[lc-auth deep-link] onOpenUrl listener failed (scheme / build / OS)',
          e,
        )
      }
    })()

    return () => {
      unlisten?.()
    }
  }, [supabase, configured])

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) return
    const desktop = typeof window !== 'undefined' && isTauri()
    /** Web: same-tab redirect. Desktop: system browser; Supabase redirects to dev HTTP bridge or lecturecompanion:// (deep link). */
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: getAuthRedirectUrl(),
        skipBrowserRedirect: desktop,
      },
    })
    if (error) throw error
    if (desktop && data.url) {
      const { open } = await import('@tauri-apps/plugin-shell')
      await open(data.url)
    }
  }, [supabase])

  const signInWithApple = useCallback(async () => {
    if (!supabase) return
    const desktop = typeof window !== 'undefined' && isTauri()
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: {
        redirectTo: getAuthRedirectUrl(),
        skipBrowserRedirect: desktop,
      },
    })
    if (error) throw error
    if (desktop && data.url) {
      const { open } = await import('@tauri-apps/plugin-shell')
      await open(data.url)
    }
  }, [supabase])

  const signInWithEmailOtp = useCallback(
    async (email: string) => {
      if (!supabase) {
        return {
          error:
            'Cloud sign-in isn’t available in this build. Use an official Youmi Lens release, or continue without an account.',
        }
      }
      const trimmed = email.trim()
      if (!trimmed) return { error: 'Enter your email address.' }
      const redirectUrl = getAuthRedirectUrl()
      console.info('[Auth] signInWithOtp redirectTo:', redirectUrl)
      console.info('[Auth] isTauri:', isTauri())
      console.info('[Auth] mode:', import.meta.env.MODE)
      console.info('[Auth] dev:', import.meta.env.DEV)
      console.info('[Auth] prod:', import.meta.env.PROD)
      setDeepLinkAuthError(null)
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { emailRedirectTo: redirectUrl },
      })
      return { error: error ? error.message : null }
    },
    [supabase],
  )

  const signOut = useCallback(async () => {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }, [supabase])

  const clearDeepLinkAuthError = useCallback(() => {
    setDeepLinkAuthError(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      configured,
      loading,
      session,
      user: session?.user ?? null,
      signInWithGoogle,
      signInWithApple,
      signInWithEmailOtp,
      signOut,
      deepLinkAuthError,
      clearDeepLinkAuthError,
    }),
    [
      configured,
      loading,
      session,
      signInWithGoogle,
      signInWithApple,
      signInWithEmailOtp,
      signOut,
      deepLinkAuthError,
      clearDeepLinkAuthError,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
