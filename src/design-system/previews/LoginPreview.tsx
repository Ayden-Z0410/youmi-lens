/**
 * Mock login screen - Youmi Lens visual only; no Supabase / auth logic.
 */
import '../tokens.css'
import { designTokens } from '../tokens'
import { YoumiLensMonogramY } from '../../branding/YoumiLensMonogramY'

const px = (n: number) => `${n}px`

export type LoginPreviewProps = {
  /** When true, fits under a surrounding shell (e.g. style guide) instead of full viewport height. */
  embedded?: boolean
}

export function LoginPreview({ embedded = false }: LoginPreviewProps) {
  const t = designTokens

  return (
    <div
      className="ds-root"
      style={{
        minHeight: embedded ? 'min(640px, calc(100vh - 200px))' : '100vh',
        background: t.colors.bgPage,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: px(t.spacing[8]),
        boxSizing: 'border-box',
      }}
    >
      <header
        style={{
          marginBottom: px(t.spacing[10]),
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

      <div
        style={{
          width: '100%',
          maxWidth: 400,
        }}
      >
        <div
          className="ds-card"
          style={{
            padding: px(t.spacing[8]),
            border: `1px solid ${t.colors.border}`,
            boxShadow: t.shadows.sm,
            background: t.colors.surface,
          }}
        >
          <h1
            style={{
              margin: `0 0 ${px(t.spacing[3])}`,
              fontSize: t.fontSize.md,
              fontWeight: 600,
              color: t.colors.text,
              letterSpacing: '-0.02em',
            }}
          >
            Sign in to sync recordings
          </h1>
          <p
            style={{
              margin: `0 0 ${px(t.spacing[4])}`,
              fontSize: t.fontSize.sm,
              color: t.colors.textMuted,
              lineHeight: t.lineHeight.relaxed,
            }}
          >
            Use the email address you want for your account. We&apos;ll send a one-time sign-in link.
          </p>
          <label
            htmlFor="login-preview-email"
            style={{
              display: 'block',
              fontSize: t.fontSize.sm,
              fontWeight: 600,
              color: t.colors.text,
              marginBottom: px(t.spacing[2]),
            }}
          >
            Email
          </label>
          <input
            id="login-preview-email"
            type="email"
            placeholder="you@example.com"
            readOnly
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: `${px(t.spacing[3])} ${px(t.spacing[4])}`,
              borderRadius: t.radii.lg,
              border: `1px solid ${t.colors.border}`,
              fontSize: t.fontSize.base,
              marginBottom: px(t.spacing[3]),
              background: t.colors.surface,
            }}
          />
          <button type="button" className="ds-btn ds-btn--primary" style={{ width: '100%' }}>
            Send sign-in link
          </button>
        </div>
      </div>

      <p
        style={{
          marginTop: 'auto',
          paddingTop: px(t.spacing[10]),
          fontSize: t.fontSize.xs,
          color: t.colors.textMuted,
          textAlign: 'center',
        }}
      >
        Preview only
      </p>
    </div>
  )
}
