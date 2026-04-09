import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { designTokens } from '../design-system/tokens'
import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_TAKEN_MESSAGE,
  normalizeOptionalPhone,
  normalizedDisplayNameKey,
  validateDisplayName,
} from '../lib/profileFields'
import {
  fetchProfile,
  isProfileDisplayNameTakenByOther,
  upsertProfileUsername,
  type UserProfileRow,
} from '../lib/userProfile'
import { AiPreferencesSection } from './AiPreferencesSection'

type Props = {
  open: boolean
  onClose: () => void
  supabase: SupabaseClient
  userId: string
  accountEmail: string | null
  profile: UserProfileRow | null
  onSaved: (row: UserProfileRow | null) => void
  onSignOut: () => void
}

export function AccountSettingsModal({
  open,
  onClose,
  supabase,
  userId,
  accountEmail,
  profile,
  onSaved,
  onSignOut,
}: Props) {
  const t = designTokens
  const px = (n: number) => `${n}px`
  const [displayName, setDisplayName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [signOutBusy, setSignOutBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setErr(null)
    setOkMsg(null)
    setDisplayName(profile?.username?.trim() ?? '')
    setPhone(profile?.phone?.trim() ?? '')
  }, [open, profile])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const prevBodyOverflow = document.body.style.overflow
    const prevHtmlOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevBodyOverflow
      document.documentElement.style.overflow = prevHtmlOverflow
    }
  }, [open])

  const handleSave = async () => {
    setErr(null)
    setOkMsg(null)
    const v = validateDisplayName(displayName)
    if (!v.ok) {
      setErr(v.message)
      return
    }
    const prevKey = normalizedDisplayNameKey(profile?.username ?? '')
    const nextKey = normalizedDisplayNameKey(v.value)
    if (nextKey !== prevKey) {
      const { taken } = await isProfileDisplayNameTakenByOther(supabase, userId, v.value)
      if (taken) {
        setErr(DISPLAY_NAME_TAKEN_MESSAGE)
        return
      }
    }
    setBusy(true)
    try {
      const { error } = await upsertProfileUsername(supabase, userId, {
        username: v.value,
        phone: normalizeOptionalPhone(phone),
      })
      if (error) {
        setErr(error)
        return
      }
      const row = await fetchProfile(supabase, userId)
      onSaved(row)
      setOkMsg('Your profile was updated.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="ds-root"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: px(t.spacing[6]),
        boxSizing: 'border-box',
        overflow: 'hidden',
        overscrollBehavior: 'contain',
      }}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-labelledby="account-settings-title"
        className="ds-card"
        style={{
          width: '100%',
          maxWidth: 420,
          border: `1px solid ${t.colors.border}`,
          background: t.colors.surface,
          borderRadius: t.radii.xl,
          boxShadow: '0 18px 48px rgba(15, 23, 42, 0.18)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: `${px(t.spacing[8])} ${px(t.spacing[8])} ${px(t.spacing[4])}`,
            borderBottom: `1px solid ${t.colors.border}`,
          }}
        >
          <h2
            id="account-settings-title"
            style={{
              margin: `0 0 ${px(t.spacing[2])}`,
              fontSize: t.fontSize.md,
              fontWeight: 600,
              color: t.colors.text,
            }}
          >
            Account
          </h2>
          <p style={{ margin: 0, fontSize: t.fontSize.sm, color: t.colors.textMuted }}>
            Update how Youmi Lens greets you and your optional phone number.
          </p>
        </div>

        <div
          style={{
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch',
            padding: `${px(t.spacing[6])} ${px(t.spacing[8])}`,
          }}
        >
          <AiPreferencesSection allowByok />

          <label className="field" style={{ display: 'block', marginBottom: px(t.spacing[4]) }}>
            <span
              style={{
                fontSize: t.fontSize.xs,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: t.colors.textMuted,
              }}
            >
              Email
            </span>
            <input
              className="login-screen__email-input"
              type="text"
              readOnly
              value={accountEmail || 'Not available for this sign-in method'}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                marginTop: px(t.spacing[2]),
                padding: `${px(t.spacing[3])} ${px(t.spacing[4])}`,
                borderRadius: t.radii.lg,
                border: `1px solid ${t.colors.border}`,
                fontSize: t.fontSize.base,
                background: t.colors.bgPage,
                color: t.colors.textMuted,
              }}
            />
          </label>

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
              maxLength={DISPLAY_NAME_MAX_LENGTH}
              autoComplete="nickname"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
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

          <label className="field" style={{ display: 'block', marginBottom: px(t.spacing[2]) }}>
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

          {okMsg ? (
            <p
              style={{
                marginTop: px(t.spacing[4]),
                marginBottom: 0,
                color: t.colors.success,
                fontSize: t.fontSize.sm,
              }}
            >
              {okMsg}
            </p>
          ) : null}
          {err ? (
            <p
              style={{
                marginTop: px(t.spacing[3]),
                marginBottom: 0,
                color: t.colors.danger,
                fontSize: t.fontSize.sm,
              }}
            >
              {err}
            </p>
          ) : null}
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: px(t.spacing[3]),
            padding: `${px(t.spacing[4])} ${px(t.spacing[8])} ${px(t.spacing[8])}`,
            borderTop: `1px solid ${t.colors.border}`,
            background: t.colors.surface,
          }}
        >
          <button
            type="button"
            className="ds-btn ds-btn--primary"
            style={{ width: '100%' }}
            disabled={busy || !displayName.trim()}
            aria-busy={busy}
            onClick={() => void handleSave()}
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          <button
            type="button"
            className="ds-btn ds-btn--secondary"
            style={{ width: '100%' }}
            disabled={busy || signOutBusy}
            aria-busy={signOutBusy}
            onClick={() => {
              if (signOutBusy) return
              setSignOutBusy(true)
              void Promise.resolve(onSignOut()).finally(() => setSignOutBusy(false))
            }}
          >
            {signOutBusy ? 'Signing out…' : 'Sign out'}
          </button>
          <button type="button" className="ds-btn ds-btn--secondary" style={{ width: '100%' }} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
