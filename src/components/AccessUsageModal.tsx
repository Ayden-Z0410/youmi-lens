import { useEffect } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { designTokens } from '../design-system/tokens'
import { BetaUsageStatus } from './BetaUsageStatus'

/**
 * Dedicated detail surface for Access & Usage, opened from the Settings
 * compact card's "View details" button. Mirrors AccountSettingsModal's
 * frame so the visual treatment stays consistent across the app.
 *
 * All quota numbers and the access label come from /api/quota/status via
 * the embedded <BetaUsageStatus /> — the backend is the single source of
 * truth. This modal contains no local quota logic.
 */
type Props = {
  open: boolean
  onClose: () => void
  supabase: SupabaseClient
}

export function AccessUsageModal({ open, onClose, supabase }: Props) {
  const t = designTokens
  const px = (n: number) => `${n}px`

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
        aria-labelledby="access-usage-title"
        className="ds-card"
        style={{
          width: '100%',
          maxWidth: 480,
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
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: px(t.spacing[3]),
            padding: `${px(t.spacing[6])} ${px(t.spacing[6])} ${px(t.spacing[3])}`,
            borderBottom: `1px solid ${t.colors.border}`,
          }}
        >
          <h2
            id="access-usage-title"
            style={{
              margin: 0,
              fontSize: t.fontSize.md,
              fontWeight: 600,
              color: t.colors.text,
            }}
          >
            Access &amp; Usage
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              flexShrink: 0,
              background: 'transparent',
              border: 'none',
              color: t.colors.textMuted,
              fontSize: t.fontSize.md,
              lineHeight: 1,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch',
            padding: `${px(t.spacing[5])} ${px(t.spacing[6])} ${px(t.spacing[6])}`,
          }}
        >
          <BetaUsageStatus open={open} supabase={supabase} />
        </div>
      </div>
    </div>
  )
}
