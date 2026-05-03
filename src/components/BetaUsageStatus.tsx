import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { designTokens } from '../design-system/tokens'
import { getAiApiBase } from '../lib/ai/apiBase'

type AdminStatus = {
  email: string
  plan_type: 'admin'
  display_name: 'Developer Mode'
  limits_bypassed: true
  message: string
}

type PublicTrialStatus = {
  email: string
  plan_type: 'public_trial'
  display_name: 'Public Beta Trial'
  used_minutes: number
  limit_minutes: number
  remaining_minutes: number
  recordings_today: number
  daily_recording_limit: number
  max_recording_minutes: number
  max_live_session_minutes: number
}

type CoreTesterStatus = {
  email: string
  plan_type: 'core_tester'
  display_name: 'Core Tester'
  used_minutes_this_month: number
  monthly_minutes_limit: number
  remaining_minutes_this_month: number
  recordings_today: number
  daily_recording_limit: number
  max_recording_minutes: number
  max_live_session_minutes: number
}

type BetaUsage = AdminStatus | PublicTrialStatus | CoreTesterStatus

type Props = {
  open: boolean
  supabase: SupabaseClient
}

function formatMinutes(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function BetaUsageStatus({ open, supabase }: Props) {
  const t = designTokens
  const px = (n: number) => `${n}px`
  const [status, setStatus] = useState<BetaUsage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const loadStatus = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error('missing_session')
      const res = await fetch(`${getAiApiBase()}/beta-usage-status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`status_${res.status}`)
      setStatus((await res.json()) as BetaUsage)
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

  const rows =
    status?.plan_type === 'admin'
      ? ['Usage limits bypassed']
      : status?.plan_type === 'core_tester'
        ? [
            `Remaining this month: ${formatMinutes(status.remaining_minutes_this_month)} / ${formatMinutes(status.monthly_minutes_limit)} minutes`,
            `Today: ${status.recordings_today} / ${status.daily_recording_limit} recordings`,
            `Max recording length: ${formatMinutes(status.max_recording_minutes)} minutes`,
          ]
        : status?.plan_type === 'public_trial'
          ? [
              `Remaining: ${formatMinutes(status.remaining_minutes)} / ${formatMinutes(status.limit_minutes)} minutes`,
              `Today: ${status.recordings_today} / ${status.daily_recording_limit} recordings`,
              `Max recording length: ${formatMinutes(status.max_recording_minutes)} minutes`,
            ]
          : []

  return (
    <section
      aria-label="Beta usage status"
      style={{
        border: `1px solid ${t.colors.border}`,
        borderRadius: t.radii.lg,
        background: t.colors.bgPage,
        padding: px(t.spacing[4]),
        marginBottom: px(t.spacing[4]),
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: px(t.spacing[3]),
        }}
      >
        <div>
          <div
            style={{
              fontSize: t.fontSize.xs,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: t.colors.textMuted,
            }}
          >
            Beta plan
          </div>
          <div style={{ marginTop: px(t.spacing[1]), fontSize: t.fontSize.sm, fontWeight: 600, color: t.colors.text }}>
            {status?.display_name ?? (loading ? 'Loading…' : 'Not available')}
          </div>
        </div>
        <button
          type="button"
          className="ds-btn ds-btn--secondary"
          style={{ padding: `${px(t.spacing[2])} ${px(t.spacing[3])}`, fontSize: t.fontSize.xs }}
          disabled={loading}
          onClick={() => void loadStatus()}
        >
          Refresh
        </button>
      </div>

      {error ? (
        <p style={{ margin: `${px(t.spacing[3])} 0 0`, color: t.colors.danger, fontSize: t.fontSize.sm }}>
          Could not load beta usage status.
        </p>
      ) : rows.length > 0 ? (
        <div style={{ display: 'grid', gap: px(t.spacing[2]), marginTop: px(t.spacing[3]) }}>
          {rows.map((row) => (
            <div key={row} style={{ fontSize: t.fontSize.sm, color: t.colors.textMuted, lineHeight: t.lineHeight.relaxed }}>
              {row}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
