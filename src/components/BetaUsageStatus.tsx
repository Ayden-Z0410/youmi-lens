import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { designTokens } from '../design-system/tokens'
import { getAiApiBase } from '../lib/ai/apiBase'

/**
 * Access & Usage card — Mac equivalent of the iPad "Access & Usage" screen.
 *
 * Reads from /api/quota/status (camelCase normalized shape). Backend is the
 * single source of truth — this component never decides limits locally.
 */

type QuotaStatus = {
  planType: string
  displayName: string
  status: 'active' | 'suspended'
  unlimited: boolean
  monthlyMinutesLimit?: number | null
  minutesUsed?: number
  minutesLimit?: number | null
  minutesRemaining?: number | null
  dailyMinutesUsed?: number
  dailyMinutesLimit?: number | null
  dailyMinutesRemaining?: number | null
  maxRecordingsPerDay?: number
  recordingsUsedToday?: number
  recordingsRemainingToday?: number
  maxRecordingMinutes?: number
  maxLiveSessionMinutes?: number
}

type QuotaResponse = {
  ok: boolean
  plan?: QuotaStatus
}

type Props = {
  open: boolean
  supabase: SupabaseClient
}

const SUBTITLE_COPY =
  'Youmi Lens is free during beta. Daily and monthly limits help keep the service stable for students.'

const SHARED_USAGE_COPY = 'Your usage is shared across iPad and Mac.'

const FOOTER_COPY =
  'Youmi Lens is currently a free educational beta. There are no paid subscriptions or in-app purchases.'

const CORE_TESTER_COPY =
  'Extended testing access is available for active users. Contact youmilens@gmail.com if you need more capacity for coursework.'

const REQUEST_MAILTO =
  'mailto:youmilens@gmail.com?subject=Youmi%20Lens%20Beta%20Access%20Request'

function formatMinutes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function isTauriWebviewShell(): boolean {
  if (typeof window === 'undefined') return false
  return (
    '__TAURI_INTERNALS__' in window ||
    window.location.protocol === 'tauri:' ||
    window.location.hostname === 'tauri.localhost'
  )
}

async function openRequestAccess(): Promise<void> {
  if (isTauriWebviewShell()) {
    try {
      const { open } = await import('@tauri-apps/plugin-shell')
      await open(REQUEST_MAILTO)
      return
    } catch {
      // fall through to web fallback
    }
  }
  if (typeof window !== 'undefined') {
    window.location.assign(REQUEST_MAILTO)
  }
}

function MetricRow({
  label,
  value,
}: {
  label: string
  value: string
}) {
  const t = designTokens
  const px = (n: number) => `${n}px`
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: px(t.spacing[3]),
        fontSize: t.fontSize.sm,
        lineHeight: t.lineHeight.relaxed,
      }}
    >
      <span style={{ color: t.colors.textMuted }}>{label}</span>
      <span style={{ color: t.colors.text, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

export function BetaUsageStatus({ open, supabase }: Props) {
  const t = designTokens
  const px = (n: number) => `${n}px`
  const [status, setStatus] = useState<QuotaStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const loadStatus = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error('missing_session')
      const res = await fetch(`${getAiApiBase()}/quota/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`status_${res.status}`)
      const payload = (await res.json()) as QuotaResponse
      if (!payload?.ok || !payload.plan) throw new Error('quota_status_unavailable')
      setStatus(payload.plan)
    } catch {
      setStatus(null)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    if (!open) return
    void loadStatus()
  }, [open, loadStatus])

  const displayName = status?.displayName ?? (loading ? 'Loading…' : 'Not available')
  const unlimited = status?.unlimited === true
  const planType = status?.planType ?? ''
  const isCoreTester = planType === 'core_tester'

  return (
    <section
      aria-label="Access and Usage"
      style={{
        border: `1px solid ${t.colors.border}`,
        borderRadius: t.radii.lg,
        background: t.colors.bgPage,
        padding: px(t.spacing[4]),
        marginBottom: px(t.spacing[4]),
      }}
    >
      {/* Header: title + Refresh status button */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: px(t.spacing[3]),
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: t.fontSize.md,
              fontWeight: 600,
              color: t.colors.text,
              lineHeight: t.lineHeight.tight,
            }}
          >
            Access &amp; Usage
          </div>
          <p
            style={{
              margin: `${px(t.spacing[1])} 0 0`,
              fontSize: t.fontSize.sm,
              color: t.colors.textMuted,
              lineHeight: t.lineHeight.relaxed,
            }}
          >
            {SUBTITLE_COPY}
          </p>
        </div>
        <button
          type="button"
          className="ds-btn ds-btn--secondary"
          style={{
            flexShrink: 0,
            padding: `${px(t.spacing[2])} ${px(t.spacing[3])}`,
            fontSize: t.fontSize.xs,
          }}
          disabled={loading}
          onClick={() => void loadStatus()}
        >
          Refresh status
        </button>
      </div>

      {/* Account access */}
      <div
        style={{
          marginTop: px(t.spacing[4]),
          paddingTop: px(t.spacing[3]),
          borderTop: `1px solid ${t.colors.border}`,
        }}
      >
        <div
          style={{
            fontSize: t.fontSize.xs,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: t.colors.textMuted,
          }}
        >
          Account access
        </div>
        <div
          style={{
            marginTop: px(t.spacing[1]),
            fontSize: t.fontSize.sm,
            fontWeight: 600,
            color: t.colors.text,
          }}
        >
          {displayName}
        </div>
      </div>

      {error ? (
        <p
          style={{
            margin: `${px(t.spacing[3])} 0 0`,
            color: t.colors.danger,
            fontSize: t.fontSize.sm,
          }}
        >
          Could not load access status.
        </p>
      ) : status ? (
        <>
          {/* Usage metrics */}
          <div
            style={{
              marginTop: px(t.spacing[4]),
              paddingTop: px(t.spacing[3]),
              borderTop: `1px solid ${t.colors.border}`,
              display: 'grid',
              gap: px(t.spacing[2]),
            }}
          >
            {unlimited ? (
              <div style={{ fontSize: t.fontSize.sm, color: t.colors.text, fontWeight: 500 }}>
                Unlimited access
              </div>
            ) : (
              <>
                {status.minutesLimit != null && (
                  <MetricRow
                    label="Monthly minutes"
                    value={`${formatMinutes(status.minutesUsed)} / ${formatMinutes(status.minutesLimit)} used · ${formatMinutes(status.minutesRemaining)} left`}
                  />
                )}
                {status.dailyMinutesLimit != null && (
                  <MetricRow
                    label="Daily minutes"
                    value={`${formatMinutes(status.dailyMinutesUsed)} / ${formatMinutes(status.dailyMinutesLimit)} used · ${formatMinutes(status.dailyMinutesRemaining)} left`}
                  />
                )}
                {status.maxRecordingsPerDay != null && status.maxRecordingsPerDay > 0 && (
                  <MetricRow
                    label="Recordings today"
                    value={`${status.recordingsUsedToday ?? 0} / ${status.maxRecordingsPerDay} used · ${status.recordingsRemainingToday ?? 0} left`}
                  />
                )}
                {status.maxRecordingMinutes != null && status.maxRecordingMinutes > 0 && (
                  <MetricRow
                    label="Max recording length"
                    value={`${formatMinutes(status.maxRecordingMinutes)} min`}
                  />
                )}
                {status.maxLiveSessionMinutes != null && status.maxLiveSessionMinutes > 0 && (
                  <MetricRow
                    label="Max live session length"
                    value={`${formatMinutes(status.maxLiveSessionMinutes)} min`}
                  />
                )}
              </>
            )}
          </div>

          {/* Shared usage note */}
          {!unlimited && (
            <p
              style={{
                margin: `${px(t.spacing[3])} 0 0`,
                fontSize: t.fontSize.xs,
                color: t.colors.textMuted,
                lineHeight: t.lineHeight.relaxed,
              }}
            >
              {SHARED_USAGE_COPY}
            </p>
          )}

          {/* Core Tester note */}
          {isCoreTester && (
            <p
              style={{
                margin: `${px(t.spacing[3])} 0 0`,
                fontSize: t.fontSize.xs,
                color: t.colors.textMuted,
                lineHeight: t.lineHeight.relaxed,
              }}
            >
              {CORE_TESTER_COPY}
            </p>
          )}
        </>
      ) : null}

      {/* Request more access */}
      <div
        style={{
          marginTop: px(t.spacing[4]),
          paddingTop: px(t.spacing[3]),
          borderTop: `1px solid ${t.colors.border}`,
          display: 'flex',
          flexDirection: 'column',
          gap: px(t.spacing[2]),
        }}
      >
        <button
          type="button"
          className="ds-btn ds-btn--secondary"
          style={{
            alignSelf: 'flex-start',
            padding: `${px(t.spacing[2])} ${px(t.spacing[3])}`,
            fontSize: t.fontSize.xs,
          }}
          onClick={() => void openRequestAccess()}
        >
          Request more access
        </button>
        <p
          style={{
            margin: 0,
            fontSize: t.fontSize.xs,
            color: t.colors.textMuted,
            lineHeight: t.lineHeight.relaxed,
          }}
        >
          {FOOTER_COPY}
        </p>
      </div>
    </section>
  )
}
