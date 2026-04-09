import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { designTokens } from '../design-system/tokens'
import { YoumiLensMonogramY } from '../branding/YoumiLensMonogramY'
import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_TAKEN_MESSAGE,
  normalizeOptionalPhone,
  validateDisplayName,
} from '../lib/profileFields'
import { isProfileDisplayNameTakenByOther } from '../lib/userProfile'

type Props = {
  userId: string
  supabase: SupabaseClient
  /** Only pre-filled when `profiles.username` already exists in DB (trimmed). */
  initialUsername?: string | null
  onSubmit: (username: string, phone: string | null) => Promise<{ error: string | null }>
}

function normalizeInitial(u: string | null | undefined): string {
  return u == null ? '' : u.trim()
}

export function OnboardingUsername({ userId, supabase, initialUsername, onSubmit }: Props) {
  const [username, setUsername] = useState(() => normalizeInitial(initialUsername))
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const t = designTokens
  const px = (n: number) => `${n}px`

  useEffect(() => {
    setUsername(normalizeInitial(initialUsername))
  }, [initialUsername])

  const handleSubmit = async () => {
    setErr(null)
    const v = validateDisplayName(username)
    if (!v.ok) {
      setErr(v.message)
      return
    }
    setBusy(true)
    try {
      const { taken } = await isProfileDisplayNameTakenByOther(supabase, userId, v.value)
      if (taken) {
        setErr(DISPLAY_NAME_TAKEN_MESSAGE)
        return
      }
      const { error } = await onSubmit(v.value, normalizeOptionalPhone(phone))
      if (error) setErr(error)
    } finally {
      setBusy(false)
    }
  }

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

      <div style={{ width: '100%', maxWidth: 400 }}>
        <div
          className="ds-card login-screen__card"
          style={{
            padding: px(t.spacing[8]),
            border: `1px solid ${t.colors.border}`,
            background: t.colors.surface,
          }}
        >
          <h1
            style={{
              margin: `0 0 ${px(t.spacing[4])}`,
              fontSize: t.fontSize.md,
              fontWeight: 600,
              color: t.colors.text,
            }}
          >
            Set up your profile
          </h1>
          <p
            style={{
              margin: `0 0 ${px(t.spacing[5])}`,
              fontSize: t.fontSize.sm,
              color: t.colors.textMuted,
              lineHeight: t.lineHeight.relaxed,
            }}
          >
            Choose a display name. You can add a phone number later; it&apos;s optional.
          </p>

          <label className="field" style={{ display: 'block', marginBottom: px(t.spacing[4]) }}>
            <span
              style={{
                fontSize: t.fontSize.xs,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: t.colors.textMuted,
              }}
            >
              Display name
            </span>
            <input
              className="login-screen__email-input"
              type="text"
              name="youlens-display-name"
              id="youlens-display-name"
              maxLength={DISPLAY_NAME_MAX_LENGTH}
              autoComplete="nickname"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="How you want to be greeted"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                marginTop: px(t.spacing[2]),
                padding: `${px(t.spacing[3])} ${px(t.spacing[4])}`,
                borderRadius: t.radii.lg,
                border: `1px solid ${t.colors.border}`,
                fontSize: t.fontSize.base,
              }}
            />
          </label>

          <label className="field" style={{ display: 'block', marginBottom: px(t.spacing[5]) }}>
            <span
              style={{
                fontSize: t.fontSize.xs,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: t.colors.textMuted,
              }}
            >
              Phone (optional)
            </span>
            <input
              className="login-screen__email-input"
              type="tel"
              name="youlens-phone"
              id="youlens-phone"
              autoComplete="tel"
              placeholder=""
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                marginTop: px(t.spacing[2]),
                padding: `${px(t.spacing[3])} ${px(t.spacing[4])}`,
                borderRadius: t.radii.lg,
                border: `1px solid ${t.colors.border}`,
                fontSize: t.fontSize.base,
              }}
            />
          </label>

          <button
            type="button"
            className="ds-btn ds-btn--primary"
            style={{ width: '100%' }}
            disabled={busy || !username.trim()}
            onClick={() => void handleSubmit()}
          >
            {busy ? 'Saving…' : 'Continue'}
          </button>
          {err && (
            <p style={{ marginTop: px(t.spacing[3]), color: t.colors.danger, fontSize: t.fontSize.sm }}>
              {err}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
