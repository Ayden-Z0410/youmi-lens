/**
 * Apple / Google buttons — a 1:1 React port of `ssoStack()` in landing/app/auth-ui.js.
 *
 * Order is Apple → Google on Website and iPad; the same order is kept here. The
 * inline SVGs are the exact APPLE_SVG / GOOGLE_SVG markup from the Website, and
 * all colour/size comes from `.yl-sso-apple` / `.yl-sso-google` in auth-shell.css.
 *
 * `word` is the verb the divider uses ("sign in" / "sign up"), matching the
 * Website call sites: ssoStack('sign in') on login, ssoStack('sign up') on register.
 */

type Provider = 'apple' | 'google'

function AppleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="#fff" aria-hidden="true">
      <path d="M11.05 8.36c-.02-1.7 1.39-2.52 1.45-2.56-.79-1.16-2.02-1.32-2.46-1.34-1.05-.11-2.04.61-2.57.61-.53 0-1.35-.6-2.22-.58-1.14.02-2.19.66-2.78 1.68-1.18 2.05-.3 5.08.85 6.74.56.81 1.23 1.72 2.11 1.69.85-.03 1.17-.55 2.2-.55s1.31.55 2.21.53c.91-.02 1.49-.83 2.05-1.64.64-.94.91-1.85.92-1.9-.02-.01-1.77-.68-1.79-2.7zM9.42 3.4c.47-.57.79-1.36.7-2.15-.68.03-1.5.45-1.98 1.02-.43.5-.81 1.3-.71 2.07.76.06 1.53-.38 1.99-.94z" />
    </svg>
  )
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72A5.4 5.4 0 0 1 3.69 9c0-.6.1-1.18.28-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  )
}

export function SsoStack({
  word,
  onProvider,
  disabled,
}: {
  /** Divider verb: "sign in" or "sign up". */
  word: string
  onProvider: (provider: Provider) => void
  /** True while any auth request is in flight — prevents a second OAuth launch. */
  disabled?: boolean
}) {
  return (
    <>
      <div className="yl-auth-sso">
        <button
          type="button"
          className="yl-sso-btn yl-sso-apple"
          disabled={disabled}
          onClick={() => onProvider('apple')}
        >
          <AppleMark /> Continue with Apple
        </button>
        <button
          type="button"
          className="yl-sso-btn yl-sso-google"
          disabled={disabled}
          onClick={() => onProvider('google')}
        >
          <GoogleMark /> Continue with Google
        </button>
      </div>
      <div className="yl-auth-divider">
        <span>or {word} with email</span>
      </div>
    </>
  )
}
