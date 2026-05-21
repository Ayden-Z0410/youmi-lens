import { useEffect, useState, type ReactNode } from 'react'
import { designTokens } from '../design-system/tokens'
import { YoumiLensMonogramY } from '../branding/YoumiLensMonogramY'
import { PasswordField } from './PasswordField'
import { useAuth } from '../useAuth'
import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  validateDisplayName,
} from '../lib/profileFields'

type View =
  | { kind: 'signIn'; flash?: string }
  | { kind: 'createProfile' }
  | { kind: 'forgotPasswordEmail' }
  | { kind: 'forgotPasswordCode'; email: string }
  | { kind: 'forgotPasswordNewPassword' }

const t = designTokens
const px = (n: number) => `${n}px`

/** Replaces the legacy magic-link LoginScreen. Self-contained auth flow with internal navigation. */
export function AuthScreens() {
  const auth = useAuth()
  const [view, setView] = useState<View>({ kind: 'signIn' })

  // When Supabase enters password-recovery mode (verifyOtp succeeded or a recovery deep link
  // arrived), force the new-password screen regardless of where the user was. This pairs with
  // the App.tsx gate that keeps AuthScreens mounted while inPasswordRecovery is true.
  useEffect(() => {
    if (auth.inPasswordRecovery && view.kind !== 'forgotPasswordNewPassword') {
      setView({ kind: 'forgotPasswordNewPassword' })
    }
  }, [auth.inPasswordRecovery, view.kind])

  switch (view.kind) {
    case 'signIn':
      return (
        <SignInScreen
          flash={view.flash}
          onGoCreateProfile={() => setView({ kind: 'createProfile' })}
          onGoForgotPassword={() => setView({ kind: 'forgotPasswordEmail' })}
        />
      )
    case 'createProfile':
      return (
        <CreateProfileScreen
          onBackToSignIn={(flash) => setView({ kind: 'signIn', flash })}
        />
      )
    case 'forgotPasswordEmail':
      return (
        <ForgotPasswordEmailScreen
          onBackToSignIn={() => setView({ kind: 'signIn' })}
          onAdvanceToCode={(email) => setView({ kind: 'forgotPasswordCode', email })}
        />
      )
    case 'forgotPasswordCode':
      return (
        <ForgotPasswordCodeScreen
          email={view.email}
          onBackToSignIn={() => setView({ kind: 'signIn' })}
          onAdvanceToNewPassword={() => setView({ kind: 'forgotPasswordNewPassword' })}
        />
      )
    case 'forgotPasswordNewPassword':
      return (
        <ForgotPasswordNewPasswordScreen
          onDone={() => setView({ kind: 'signIn', flash: 'Password updated. Please sign in.' })}
        />
      )
  }
}

function AuthCardShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="ds-root login-screen"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: px(t.spacing[8]),
        boxSizing: 'border-box',
      }}
    >
      <header
        style={{
          marginBottom: px(t.spacing[8]),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: px(t.spacing[4]),
        }}
      >
        <YoumiLensMonogramY size={32} color={t.colors.primary} aria-hidden />
        <span
          style={{
            fontSize: t.fontSize.xl,
            fontWeight: 600,
            letterSpacing: '-0.035em',
            color: t.colors.primary,
          }}
        >
          Youmi Lens
        </span>
      </header>

      <div style={{ width: '100%', maxWidth: 400, position: 'relative', zIndex: 1 }}>
        <div
          className="ds-card login-screen__card"
          style={{
            padding: `${px(t.spacing[6])} ${px(t.spacing[8])}`,
            border: `1px solid ${t.colors.border}`,
            background: t.colors.surface,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label
      htmlFor={htmlFor}
      style={{
        display: 'block',
        fontSize: t.fontSize.sm,
        fontWeight: 600,
        color: t.colors.text,
        marginBottom: px(t.spacing[2]),
      }}
    >
      {children}
    </label>
  )
}

function TextInput({
  id,
  value,
  onChange,
  placeholder,
  type = 'text',
  autoComplete,
  inputMode,
  maxLength,
  className,
  onEnter,
  disabled,
}: {
  id: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  type?: 'text' | 'email'
  autoComplete?: string
  inputMode?: 'text' | 'email' | 'numeric'
  maxLength?: number
  className?: string
  onEnter?: () => void
  disabled?: boolean
}) {
  return (
    <input
      id={id}
      type={type}
      className={className ?? 'login-screen__email-input auth-input'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete={autoComplete}
      inputMode={inputMode}
      maxLength={maxLength}
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      disabled={disabled}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) {
          e.preventDefault()
          onEnter()
        }
      }}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        padding: `${px(t.spacing[3])} ${px(t.spacing[4])}`,
        borderRadius: t.radii.lg,
        border: `1px solid ${t.colors.border}`,
        fontSize: t.fontSize.base,
        background: t.colors.surface,
        color: t.colors.text,
        caretColor: t.colors.accent,
      }}
    />
  )
}

function FormHint({ children }: { children: ReactNode }) {
  return (
    <p style={{ marginTop: px(t.spacing[3]), fontSize: t.fontSize.sm, color: t.colors.textMuted }}>
      {children}
    </p>
  )
}

function FormError({ children }: { children: ReactNode }) {
  return (
    <p style={{ marginTop: px(t.spacing[3]), fontSize: t.fontSize.sm, color: t.colors.danger }}>
      {children}
    </p>
  )
}

function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'transparent',
        border: 'none',
        padding: 0,
        color: t.colors.accent,
        fontSize: t.fontSize.sm,
        fontWeight: 600,
        cursor: 'pointer',
        textDecoration: 'underline',
      }}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Sign In
// ---------------------------------------------------------------------------

function SignInScreen({
  flash,
  onGoCreateProfile,
  onGoForgotPassword,
}: {
  flash?: string
  onGoCreateProfile: () => void
  onGoForgotPassword: () => void
}) {
  const auth = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    setErr(null)
    setBusy(true)
    try {
      const { error } = await auth.signInWithPassword(email, password)
      if (error) setErr(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCardShell>
      <h1
        style={{
          margin: `0 0 ${px(t.spacing[3])}`,
          fontSize: t.fontSize.md,
          fontWeight: 600,
          color: t.colors.text,
          letterSpacing: '-0.02em',
        }}
      >
        Sign in to Youmi Lens
      </h1>

      {flash ? (
        <p
          style={{
            margin: `0 0 ${px(t.spacing[4])}`,
            fontSize: t.fontSize.sm,
            color: t.colors.success,
          }}
        >
          {flash}
        </p>
      ) : null}

      <FieldLabel htmlFor="signin-email">Email</FieldLabel>
      <TextInput
        id="signin-email"
        type="email"
        value={email}
        onChange={setEmail}
        placeholder="you@example.com"
        autoComplete="email"
        inputMode="email"
        onEnter={() => void submit()}
      />
      <div style={{ height: px(t.spacing[3]) }} />
      <PasswordField
        id="signin-password"
        label="Password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
        onEnter={() => void submit()}
      />

      <div style={{ height: px(t.spacing[4]) }} />
      <button
        type="button"
        className="ds-btn ds-btn--primary"
        style={{ width: '100%' }}
        aria-busy={busy}
        disabled={busy || !email.trim() || !password}
        onClick={() => void submit()}
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>

      {err ? <FormError>{err}</FormError> : null}
      {auth.deepLinkAuthError ? <FormError>{auth.deepLinkAuthError}</FormError> : null}

      <div
        style={{
          marginTop: px(t.spacing[5]),
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: px(t.spacing[3]),
        }}
      >
        <LinkButton onClick={onGoForgotPassword}>Forgot password?</LinkButton>
        <p style={{ margin: 0, fontSize: t.fontSize.sm, color: t.colors.textMuted }}>
          New to Youmi Lens?{' '}
          <LinkButton onClick={onGoCreateProfile}>Create profile</LinkButton>
        </p>
      </div>
    </AuthCardShell>
  )
}

// ---------------------------------------------------------------------------
// Create Profile
// ---------------------------------------------------------------------------

const EMAIL_EXISTS_MESSAGE =
  'This email is already registered. Please sign in instead.'

function CreateProfileScreen({
  onBackToSignIn,
}: {
  onBackToSignIn: (flash?: string) => void
}) {
  const auth = useAuth()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'collect' | 'verify'>('collect')
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [emailExists, setEmailExists] = useState(false)

  const validateCollect = (): string | null => {
    const v = validateDisplayName(username)
    if (!v.ok) return v.message
    if (!email.trim()) return 'Enter your email address.'
    if (password.length < 8) return 'Password must be at least 8 characters.'
    if (password !== confirmPassword) return 'Passwords do not match.'
    return null
  }

  const sendCode = async () => {
    setErr(null)
    setHint(null)
    setEmailExists(false)
    const problem = validateCollect()
    if (problem) {
      setErr(problem)
      return
    }
    setBusy(true)
    try {
      const result = await auth.requestSignupCode({ email, username })
      if (result.code === 'email_exists') {
        setEmailExists(true)
        setErr(EMAIL_EXISTS_MESSAGE)
        // Stay on the collect stage; do not advance to code entry.
        setStage('collect')
        return
      }
      if (result.error) {
        setErr(result.error)
        return
      }
      setStage('verify')
      setHint('We sent an 8-digit verification code to your email.')
    } finally {
      setBusy(false)
    }
  }

  const verifyAndCreate = async () => {
    setErr(null)
    setHint(null)
    setEmailExists(false)
    if (!/^\d{8}$/.test(code.replace(/\s/g, ''))) {
      setErr('Enter the full 8-digit code.')
      return
    }
    setBusy(true)
    try {
      const verifyResult = await auth.verifySignupCodeAndCreateUser({
        email,
        username,
        password,
        code,
      })
      if (verifyResult.code === 'email_exists') {
        // Race: account was created elsewhere between send-code and verify. Bounce to Sign In.
        setEmailExists(true)
        setStage('collect')
        setErr(EMAIL_EXISTS_MESSAGE)
        return
      }
      if (verifyResult.error) {
        setErr(verifyResult.error)
        return
      }
      // Backend created the user but did not return a session. Sign in to establish one.
      const signInResult = await auth.signInWithPassword(email, password)
      if (signInResult.error) {
        // Account was created — guide the user back to sign in manually.
        onBackToSignIn(
          'Account created. Please sign in with your email and password.',
        )
        return
      }
      // Session established — AuthProvider will rerender the app shell.
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCardShell>
      <h1
        style={{
          margin: `0 0 ${px(t.spacing[3])}`,
          fontSize: t.fontSize.md,
          fontWeight: 600,
          color: t.colors.text,
          letterSpacing: '-0.02em',
        }}
      >
        Create profile
      </h1>
      <p
        style={{
          margin: `0 0 ${px(t.spacing[4])}`,
          fontSize: t.fontSize.sm,
          color: t.colors.textMuted,
          lineHeight: t.lineHeight.relaxed,
        }}
      >
        Choose a username and password. We&apos;ll email a verification code to confirm your address.
      </p>

      {stage === 'collect' ? (
        <>
          <FieldLabel htmlFor="cp-username">Username</FieldLabel>
          <TextInput
            id="cp-username"
            value={username}
            onChange={setUsername}
            placeholder="How you want to be greeted"
            autoComplete="nickname"
            maxLength={DISPLAY_NAME_MAX_LENGTH}
          />
          <p
            style={{
              marginTop: px(t.spacing[2]),
              marginBottom: px(t.spacing[3]),
              fontSize: t.fontSize.xs,
              color: t.colors.textMuted,
            }}
          >
            {DISPLAY_NAME_MIN_LENGTH}–{DISPLAY_NAME_MAX_LENGTH} characters.
          </p>

          <FieldLabel htmlFor="cp-email">Email</FieldLabel>
          <TextInput
            id="cp-email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            autoComplete="email"
            inputMode="email"
          />
          <div style={{ height: px(t.spacing[3]) }} />
          <PasswordField
            id="cp-password"
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            minLength={8}
          />
          <div style={{ height: px(t.spacing[3]) }} />
          <PasswordField
            id="cp-confirm-password"
            label="Confirm password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            minLength={8}
            onEnter={() => void sendCode()}
          />
          <div style={{ height: px(t.spacing[4]) }} />
          <button
            type="button"
            className="ds-btn ds-btn--primary"
            style={{ width: '100%' }}
            aria-busy={busy}
            disabled={
              busy ||
              !username.trim() ||
              !email.trim() ||
              !password ||
              !confirmPassword
            }
            onClick={() => void sendCode()}
          >
            {busy ? 'Sending code…' : 'Send verification code'}
          </button>
        </>
      ) : (
        <>
          <FieldLabel htmlFor="cp-code">Verification code</FieldLabel>
          <TextInput
            id="cp-code"
            value={code}
            onChange={(v) => setCode(v.replace(/\s/g, ''))}
            placeholder="••••••••"
            inputMode="numeric"
            maxLength={8}
            className="login-screen__email-input auth-input code-input"
            onEnter={() => void verifyAndCreate()}
          />
          <div style={{ height: px(t.spacing[4]) }} />
          <button
            type="button"
            className="ds-btn ds-btn--primary"
            style={{ width: '100%' }}
            aria-busy={busy}
            disabled={busy || code.replace(/\s/g, '').length !== 8}
            onClick={() => void verifyAndCreate()}
          >
            {busy ? 'Creating account…' : 'Verify and create profile'}
          </button>
          <div style={{ height: px(t.spacing[2]) }} />
          <button
            type="button"
            className="ds-btn ds-btn--secondary"
            style={{ width: '100%' }}
            disabled={busy}
            onClick={() => {
              setStage('collect')
              setHint(null)
              setErr(null)
            }}
          >
            Back
          </button>
        </>
      )}

      {hint ? <FormHint>{hint}</FormHint> : null}
      {err ? <FormError>{err}</FormError> : null}

      {emailExists ? (
        <button
          type="button"
          className="ds-btn ds-btn--secondary"
          style={{ width: '100%', marginTop: px(t.spacing[3]) }}
          onClick={() => onBackToSignIn()}
        >
          Sign in instead
        </button>
      ) : null}

      <div
        style={{
          marginTop: px(t.spacing[5]),
          textAlign: 'center',
          fontSize: t.fontSize.sm,
          color: t.colors.textMuted,
        }}
      >
        Already have an account?{' '}
        <LinkButton onClick={() => onBackToSignIn()}>Sign in</LinkButton>
      </div>
    </AuthCardShell>
  )
}

// ---------------------------------------------------------------------------
// Forgot Password — Step 1: email entry
// ---------------------------------------------------------------------------

function ForgotPasswordEmailScreen({
  onBackToSignIn,
  onAdvanceToCode,
}: {
  onBackToSignIn: () => void
  onAdvanceToCode: (email: string) => void
}) {
  const auth = useAuth()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    setErr(null)
    const trimmed = email.trim()
    if (!trimmed) {
      setErr('Enter your email address.')
      return
    }
    setBusy(true)
    try {
      await auth.requestPasswordResetCode(trimmed)
      onAdvanceToCode(trimmed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCardShell>
      <h1
        style={{
          margin: `0 0 ${px(t.spacing[3])}`,
          fontSize: t.fontSize.md,
          fontWeight: 600,
          color: t.colors.text,
          letterSpacing: '-0.02em',
        }}
      >
        Forgot your password?
      </h1>
      <p
        style={{
          margin: `0 0 ${px(t.spacing[4])}`,
          fontSize: t.fontSize.sm,
          color: t.colors.textMuted,
          lineHeight: t.lineHeight.relaxed,
        }}
      >
        Enter the email you signed up with. We&apos;ll send a verification code so you can set a new password.
      </p>

      <FieldLabel htmlFor="fp-email">Email</FieldLabel>
      <TextInput
        id="fp-email"
        type="email"
        value={email}
        onChange={setEmail}
        placeholder="you@example.com"
        autoComplete="email"
        inputMode="email"
        onEnter={() => void submit()}
      />

      <div style={{ height: px(t.spacing[4]) }} />
      <button
        type="button"
        className="ds-btn ds-btn--primary"
        style={{ width: '100%' }}
        aria-busy={busy}
        disabled={busy || !email.trim()}
        onClick={() => void submit()}
      >
        {busy ? 'Sending…' : 'Send verification code'}
      </button>

      {err ? <FormError>{err}</FormError> : null}

      <div
        style={{
          marginTop: px(t.spacing[5]),
          textAlign: 'center',
          fontSize: t.fontSize.sm,
          color: t.colors.textMuted,
        }}
      >
        <LinkButton onClick={onBackToSignIn}>Back to sign in</LinkButton>
      </div>
    </AuthCardShell>
  )
}

// ---------------------------------------------------------------------------
// Forgot Password — Step 2: code entry
// ---------------------------------------------------------------------------

function ForgotPasswordCodeScreen({
  email,
  onBackToSignIn,
  onAdvanceToNewPassword,
}: {
  email: string
  onBackToSignIn: () => void
  onAdvanceToNewPassword: () => void
}) {
  const auth = useAuth()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    setErr(null)
    const cleaned = code.replace(/\s/g, '')
    if (!cleaned) {
      setErr('Enter the verification code.')
      return
    }
    setBusy(true)
    try {
      const { error } = await auth.verifyPasswordResetCode(email, cleaned)
      if (error) {
        setErr(error)
        return
      }
      onAdvanceToNewPassword()
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCardShell>
      <h1
        style={{
          margin: `0 0 ${px(t.spacing[3])}`,
          fontSize: t.fontSize.md,
          fontWeight: 600,
          color: t.colors.text,
          letterSpacing: '-0.02em',
        }}
      >
        Enter verification code
      </h1>
      <p
        style={{
          margin: `0 0 ${px(t.spacing[4])}`,
          fontSize: t.fontSize.sm,
          color: t.colors.textMuted,
          lineHeight: t.lineHeight.relaxed,
        }}
      >
        If an account exists for this email, we sent a verification code. Enter it below to continue.
      </p>

      <FieldLabel htmlFor="fp-code">Verification code</FieldLabel>
      <TextInput
        id="fp-code"
        value={code}
        onChange={(v) => setCode(v.replace(/\s/g, ''))}
        placeholder="••••••"
        inputMode="numeric"
        className="login-screen__email-input auth-input code-input"
        onEnter={() => void submit()}
      />

      <div style={{ height: px(t.spacing[4]) }} />
      <button
        type="button"
        className="ds-btn ds-btn--primary"
        style={{ width: '100%' }}
        aria-busy={busy}
        disabled={busy || code.replace(/\s/g, '').length === 0}
        onClick={() => void submit()}
      >
        {busy ? 'Verifying…' : 'Verify code'}
      </button>

      {err ? <FormError>{err}</FormError> : null}

      <div
        style={{
          marginTop: px(t.spacing[5]),
          textAlign: 'center',
          fontSize: t.fontSize.sm,
          color: t.colors.textMuted,
        }}
      >
        <LinkButton onClick={onBackToSignIn}>Back to sign in</LinkButton>
      </div>
    </AuthCardShell>
  )
}

// ---------------------------------------------------------------------------
// Forgot Password — Step 3: new password
// ---------------------------------------------------------------------------

function ForgotPasswordNewPasswordScreen({ onDone }: { onDone: () => void }) {
  const auth = useAuth()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    setErr(null)
    if (newPassword.length < 8) {
      setErr('Password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setErr('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const { error } = await auth.updatePassword(newPassword)
      if (error) {
        setErr(error)
        return
      }
      // Sign out to clear the recovery session and force a fresh sign-in.
      try {
        await auth.signOut()
      } catch {
        /* signOut errors don't block the navigation back */
      }
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCardShell>
      <h1
        style={{
          margin: `0 0 ${px(t.spacing[3])}`,
          fontSize: t.fontSize.md,
          fontWeight: 600,
          color: t.colors.text,
          letterSpacing: '-0.02em',
        }}
      >
        Set a new password
      </h1>
      <p
        style={{
          margin: `0 0 ${px(t.spacing[4])}`,
          fontSize: t.fontSize.sm,
          color: t.colors.textMuted,
          lineHeight: t.lineHeight.relaxed,
        }}
      >
        Choose a new password (at least 8 characters). You&apos;ll be signed out and asked to sign in again.
      </p>

      <PasswordField
        id="fp-new-password"
        label="New password"
        value={newPassword}
        onChange={setNewPassword}
        autoComplete="new-password"
        minLength={8}
      />
      <div style={{ height: px(t.spacing[3]) }} />
      <PasswordField
        id="fp-confirm-password"
        label="Confirm new password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        autoComplete="new-password"
        minLength={8}
        onEnter={() => void submit()}
      />

      <div style={{ height: px(t.spacing[4]) }} />
      <button
        type="button"
        className="ds-btn ds-btn--primary"
        style={{ width: '100%' }}
        aria-busy={busy}
        disabled={busy || !newPassword || !confirmPassword}
        onClick={() => void submit()}
      >
        {busy ? 'Updating…' : 'Update password'}
      </button>

      {err ? <FormError>{err}</FormError> : null}
    </AuthCardShell>
  )
}
