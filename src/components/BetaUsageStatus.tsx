import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { designTokens } from '../design-system/tokens'
import { getAiApiBase } from '../lib/ai/apiBase'
import { openExternalContact } from '../lib/openExternalContact'

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
  'Youmi Lens is free to use. Daily and monthly limits help keep the service stable for students.'

const SHARED_USAGE_COPY = 'Your usage is shared across iPad and Mac.'

const FOOTER_COPY =
  'Youmi Lens currently provides free educational access. There are no paid subscriptions or in-app purchases.'

const CORE_TESTER_COPY =
  'Extended testing access is available for active users. Contact youmilens@gmail.com if you need more capacity for coursework.'

const REQUEST_HELPER_COPY =
  'Need more access for coursework? Email us and tell us how you are using Youmi Lens.'

const UNLIMITED_BODY_COPY = 'This account has unlimited developer access.'

/**
 * Gmail compose URL for access requests. We use Gmail compose instead of a
 * `mailto:` link because mailto handlers on macOS often resolve to Chrome,
 * leaving the user on a blank browser page instead of in a compose window.
 * The Gmail compose URL is predictable for Youmi Lens support.
 */
const REQUEST_CONTACT_URL =
  'https://mail.google.com/mail/?view=cm&fs=1&to=youmilens@gmail.com' +
  '&su=Youmi%20Lens%20Access%20Request' +
  '&body=Hi%20Youmi%20Lens%20team%2C%0A%0AI%20would%20like%20to%20request%20more%20access.' +
  '%0A%0AMy%20use%20case%3A%0A%5BPlease%20briefly%20describe%20how%20you%20use%20Youmi%20Lens%20for%20coursework.%5D' +
  '%0A%0AThanks.'

/**
 * Frontend display normalizer. Backend `/api/quota/status` may still return
 * `displayName: "Free Beta"` for `public_trial` users; the Mac UI no longer
 * uses Beta wording, so we remap it here without changing backend logic.
 */
function normalizeAccessLabel(planType: string | undefined | null, displayName: string | undefined | null): string {
  const t = (planType || '').toLowerCase().trim()
  if (['admin', 'developer', 'dev', 'internal_developer'].includes(t)) {
    if (displayName && !/beta/i.test(displayName)) return displayName
    return 'Developer'
  }
  if (['core_tester', 'tester'].includes(t)) return 'Core Tester'
  if (t === 'public_trial') return 'Free Access'
  if (displayName && !/beta/i.test(displayName)) return displayName
  return 'Free Access'
}

function formatMinutes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
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

/**
 * Subtle 4px usage bar used under MetricRow inside the detail modal. Returns
 * null when the limit value is missing so we never fake progress.
 */
function ModalUsageBar({
  used,
  limit,
}: {
  used: number | null | undefined
  limit: number | null | undefined
}) {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) return null
  const u = Number.isFinite(used as number) ? Math.max(0, Number(used)) : 0
  const pct = Math.max(0, Math.min(100, (u / limit) * 100))
  return (
    <div
      aria-hidden
      style={{
        height: 4,
        borderRadius: 999,
        background: 'rgba(6, 27, 52, 0.08)',
        overflow: 'hidden',
        width: '100%',
        marginTop: 4,
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          borderRadius: 'inherit',
          background: 'rgba(47, 101, 184, 0.78)',
          transition: 'width 240ms ease',
        }}
      />
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

  const displayName = status
    ? normalizeAccessLabel(status.planType, status.displayName)
    : loading
      ? 'Loading…'
      : 'Not available'
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
      {/* Subtitle + Refresh status button. The owning modal renders the title. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: px(t.spacing[3]),
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: t.fontSize.sm,
            color: t.colors.textMuted,
            lineHeight: t.lineHeight.relaxed,
          }}
        >
          {SUBTITLE_COPY}
        </p>
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

      {/* Account access — calmer single-line row */}
      <div
        style={{
          marginTop: px(t.spacing[4]),
          paddingTop: px(t.spacing[3]),
          borderTop: `1px solid ${t.colors.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: px(t.spacing[3]),
        }}
      >
        <span style={{ color: t.colors.textMuted, fontSize: t.fontSize.sm }}>Account access</span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0.18rem 0.6rem',
            borderRadius: 999,
            background: 'rgba(220, 235, 250, 0.78)',
            color: '#2f65b7',
            fontSize: t.fontSize.xs,
            fontWeight: 700,
          }}
        >
          {displayName}
        </span>
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
                {UNLIMITED_BODY_COPY}
              </div>
            ) : (
              <>
                {status.minutesLimit != null && (
                  <div>
                    <MetricRow
                      label="Monthly minutes"
                      value={`${formatMinutes(status.minutesUsed)} / ${formatMinutes(status.minutesLimit)} used · ${formatMinutes(status.minutesRemaining)} left`}
                    />
                    <ModalUsageBar used={status.minutesUsed} limit={status.minutesLimit} />
                  </div>
                )}
                {status.dailyMinutesLimit != null && (
                  <div>
                    <MetricRow
                      label="Daily minutes"
                      value={`${formatMinutes(status.dailyMinutesUsed)} / ${formatMinutes(status.dailyMinutesLimit)} used · ${formatMinutes(status.dailyMinutesRemaining)} left`}
                    />
                    <ModalUsageBar used={status.dailyMinutesUsed} limit={status.dailyMinutesLimit} />
                  </div>
                )}
                {status.maxRecordingsPerDay != null && status.maxRecordingsPerDay > 0 && (
                  <div>
                    <MetricRow
                      label="Recordings today"
                      value={`${status.recordingsUsedToday ?? 0} / ${status.maxRecordingsPerDay} used · ${status.recordingsRemainingToday ?? 0} left`}
                    />
                    <ModalUsageBar used={status.recordingsUsedToday} limit={status.maxRecordingsPerDay} />
                  </div>
                )}
                {status.maxRecordingMinutes != null && status.maxRecordingMinutes > 0 && (
                  <MetricRow
                    label="Per-session recording limit"
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
        <p
          style={{
            margin: 0,
            fontSize: t.fontSize.sm,
            color: t.colors.text,
            lineHeight: t.lineHeight.relaxed,
          }}
        >
          {REQUEST_HELPER_COPY}
        </p>
        <button
          type="button"
          className="ds-btn ds-btn--secondary"
          style={{
            alignSelf: 'flex-start',
            padding: `${px(t.spacing[2])} ${px(t.spacing[3])}`,
            fontSize: t.fontSize.xs,
          }}
          onClick={() => void openExternalContact(REQUEST_CONTACT_URL)}
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
