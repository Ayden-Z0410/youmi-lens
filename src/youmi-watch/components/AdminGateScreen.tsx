/**
 * Youmi Watch gate screens — the standalone, self-contained states shown before
 * the dashboard mounts. Uses the Youmi Watch liquid-glass system (icy backdrop +
 * centered glass card) and deliberately does NOT resemble or link to the main
 * Youmi Lens login. The dashboard tree does not mount until the server-verified
 * check authorizes the signed-in user.
 *
 *   GateLoading      — while the access check is pending
 *   WatchSignIn      — email/password sign-in (shown when not signed in)
 *   AccessDeniedScreen — signed in, but not an authorized admin/developer
 *
 * Authentication happens via Supabase (watchAuth.ts); authorization is decided
 * server-side (adminAccess.ts). Nothing here trusts email or localStorage.
 */
import { useState, type FormEvent, type ReactNode } from 'react'
import { YoumiLensMonogramY } from '../../branding/YoumiLensMonogramY'
import { WatchIcon } from './WatchIcons'

function GateShell({ children }: { children: ReactNode }) {
  return (
    <div className="yw-root">
      <div className="yw-gate">
        <div className="yw-gate__brand">
          <span className="yw-gate__mark">
            <YoumiLensMonogramY size={22} color="#ffffff" />
          </span>
          <div>
            <div className="yw-gate__title-brand">Youmi Watch</div>
            <div className="yw-gate__subtitle-brand">Developer Monitor</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

export function GateLoading() {
  return (
    <GateShell>
      <div className="yw-gate__body">
        <span className="yw-spinner" aria-hidden />
        <p className="yw-gate__status" role="status">
          Verifying access…
        </p>
      </div>
    </GateShell>
  )
}

export interface WatchSignInProps {
  onSubmit: (email: string, password: string) => void
  submitting: boolean
  error: string | null
}

export function WatchSignIn({ onSubmit, submitting, error }: WatchSignInProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (canSubmit) onSubmit(email, password)
  }

  return (
    <GateShell>
      <div className="yw-gate__body">
        <h1 className="yw-gate__title">Sign in</h1>
        <p className="yw-gate__text">Sign in with an authorized developer account to continue.</p>

        <form className="yw-gate__form" onSubmit={handleSubmit} noValidate>
          <input
            className="yw-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="Email"
            aria-label="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
          />
          <input
            className="yw-input"
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            aria-label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
          />
          {error && (
            <p className="yw-gate__error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="yw-btn yw-btn--primary" disabled={!canSubmit}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </GateShell>
  )
}

export interface AccessDeniedScreenProps {
  onTryAnother: () => void
  onBackToSignIn: () => void
}

export function AccessDeniedScreen({ onTryAnother, onBackToSignIn }: AccessDeniedScreenProps) {
  return (
    <GateShell>
      <div className="yw-gate__body">
        <span className="yw-gate__icon is-denied">
          <WatchIcon name="shield" size={22} />
        </span>
        <h1 className="yw-gate__title">Access denied</h1>
        <p className="yw-gate__text">
          This account is signed in, but is not authorized for Youmi Watch. Access is limited to
          admin and developer accounts verified server-side.
        </p>
        <div className="yw-gate__actions">
          <button type="button" className="yw-btn yw-btn--primary" onClick={onTryAnother}>
            Try another account
          </button>
          <button type="button" className="yw-btn yw-btn--secondary" onClick={onBackToSignIn}>
            Back to sign in
          </button>
        </div>
      </div>
    </GateShell>
  )
}
