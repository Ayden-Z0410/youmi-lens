/**
 * Desktop Billing / Plan modal (Commercialization V2 · Phase 2B-2).
 *
 * Displays authoritative billing + quota from useBilling. Does not launch
 * Checkout or Customer Portal in this slice.
 */
import { useEffect, useId, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { designTokens } from '../design-system/tokens'
import { useBilling, type UseBillingResult } from '../hooks/useBilling'
import type { BillingState, NormalizedBillingInterval, NormalizedQuota } from '../lib/billing/billingState'
import {
  handleBillingModalEscape,
  handleBillingModalOverlayMouseDown,
} from './billingPlanModalChrome'
import './BillingPlanModal.css'

export type BillingPlanModalProps = {
  open: boolean
  onClose: () => void
  /** Optional inject for tests — production uses useBilling(). */
  billing?: UseBillingResult
}

const STUDENT_BASIC_BENEFITS = [
  '600 Study Minutes per month',
  '6 Recordings per day',
  '10 Study Tasks per day',
] as const

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(
    new Date(ms),
  )
}

function formatCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function planLabel(planCode: string | null | undefined): string {
  if (planCode === 'student_basic_monthly' || planCode === 'student_basic_annual') return 'Student Basic'
  return 'Student Basic'
}

function intervalLabel(interval: NormalizedBillingInterval | null | undefined): string | null {
  if (interval === 'monthly') return 'Monthly'
  if (interval === 'annual') return 'Annual'
  return null
}

function QuotaUsageRows({ quota }: { quota: NormalizedQuota }) {
  const minutesLimit = quota.monthlyMinutesLimit
  const recordingsLimit = quota.maxRecordingsPerDay
  const tasksLimit = quota.maxStudyTasksPerDay

  return (
    <div className="billing-plan-modal__usage" aria-label="Usage">
      <h3 className="billing-plan-modal__section-title">Usage</h3>
      <div className="billing-plan-modal__usage-row">
        <div className="billing-plan-modal__usage-label">Study Minutes</div>
        <div className="billing-plan-modal__usage-value">
          {minutesLimit == null
            ? 'Limit unavailable'
            : `${formatCount(quota.minutesUsed)} used · ${formatCount(minutesLimit)} / month`}
          {quota.minutesRemaining != null ? ` · ${formatCount(quota.minutesRemaining)} remaining` : null}
        </div>
      </div>
      <div className="billing-plan-modal__usage-row">
        <div className="billing-plan-modal__usage-label">Recordings</div>
        <div className="billing-plan-modal__usage-value">
          {recordingsLimit == null
            ? 'Limit unavailable'
            : `${formatCount(quota.recordingsUsedToday)} used today · ${formatCount(recordingsLimit)} / day`}
          {quota.recordingsRemainingToday != null
            ? ` · ${formatCount(quota.recordingsRemainingToday)} remaining`
            : null}
        </div>
      </div>
      <div className="billing-plan-modal__usage-row">
        <div className="billing-plan-modal__usage-label">Study Tasks</div>
        <div className="billing-plan-modal__usage-value">
          {tasksLimit == null
            ? 'Limit unavailable'
            : quota.studyTasksUsedToday != null
              ? `${formatCount(quota.studyTasksUsedToday)} used today · ${formatCount(tasksLimit)} / day`
              : `${formatCount(tasksLimit)} per day`}
          {quota.studyTasksRemainingToday != null
            ? ` · ${formatCount(quota.studyTasksRemainingToday)} remaining`
            : null}
        </div>
      </div>
    </div>
  )
}

function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'ok' | 'warn' | 'danger' }) {
  return (
    <span className={`billing-plan-modal__pill billing-plan-modal__pill--${tone}`}>
      <span className="billing-plan-modal__pill-text">{label}</span>
    </span>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="billing-plan-modal__meta-row">
      <span className="billing-plan-modal__meta-label">{label}</span>
      <span className="billing-plan-modal__meta-value">{value}</span>
    </div>
  )
}

export type BillingPlanContentProps = {
  state: BillingState
  onRetry?: () => void
  /** Visual-only free-plan interval highlight (no Checkout). */
  previewInterval?: NormalizedBillingInterval
  onPreviewIntervalChange?: (interval: NormalizedBillingInterval) => void
}

/** Presentational body — used by the modal and unit tests. */
export function BillingPlanContent({
  state,
  onRetry,
  previewInterval = 'monthly',
  onPreviewIntervalChange,
}: BillingPlanContentProps) {
  if (state.status === 'signed_out') {
    return (
      <div className="billing-plan-modal__panel" data-billing-status="signed_out">
        <h3 className="billing-plan-modal__headline">Sign in to view your plan</h3>
        <p className="billing-plan-modal__copy">
          Billing and usage are linked to your Youmi Lens account. Sign in to see your current plan
          and quotas.
        </p>
      </div>
    )
  }

  if (state.status === 'loading') {
    return (
      <div className="billing-plan-modal__panel" data-billing-status="loading" aria-busy="true">
        <p className="billing-plan-modal__copy">Loading plan information…</p>
        <div className="billing-plan-modal__skeleton" aria-hidden>
          <div className="billing-plan-modal__skeleton-line" />
          <div className="billing-plan-modal__skeleton-line billing-plan-modal__skeleton-line--short" />
          <div className="billing-plan-modal__skeleton-line" />
        </div>
      </div>
    )
  }

  if (state.status === 'unavailable') {
    return (
      <div className="billing-plan-modal__panel" data-billing-status="unavailable">
        <h3 className="billing-plan-modal__headline">Billing information is temporarily unavailable</h3>
        <p className="billing-plan-modal__copy">{state.reason}</p>
        {onRetry ? (
          <button type="button" className="ds-btn ds-btn--secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>
    )
  }

  if (state.status === 'free') {
    return (
      <div className="billing-plan-modal__panel" data-billing-status="free">
        <div className="billing-plan-modal__header-row">
          <div>
            <p className="billing-plan-modal__eyebrow">Current plan</p>
            <h3 className="billing-plan-modal__headline">Free</h3>
          </div>
          <StatusPill label="Free access" tone="neutral" />
        </div>

        <div className="billing-plan-modal__preview">
          <h3 className="billing-plan-modal__section-title">Student Basic</h3>
          <div className="billing-plan-modal__interval-toggle" role="group" aria-label="Billing interval preview">
            <button
              type="button"
              className={
                previewInterval === 'monthly'
                  ? 'billing-plan-modal__interval-btn billing-plan-modal__interval-btn--selected'
                  : 'billing-plan-modal__interval-btn'
              }
              aria-pressed={previewInterval === 'monthly'}
              onClick={() => onPreviewIntervalChange?.('monthly')}
            >
              Monthly · $4.99
            </button>
            <button
              type="button"
              className={
                previewInterval === 'annual'
                  ? 'billing-plan-modal__interval-btn billing-plan-modal__interval-btn--selected'
                  : 'billing-plan-modal__interval-btn'
              }
              aria-pressed={previewInterval === 'annual'}
              onClick={() => onPreviewIntervalChange?.('annual')}
            >
              Annual · $49.99
            </button>
          </div>
          <ul className="billing-plan-modal__benefits">
            {STUDENT_BASIC_BENEFITS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="billing-plan-modal__footnote">Upgrade checkout opens in a later step.</p>
        </div>

        <QuotaUsageRows quota={state.quota} />
      </div>
    )
  }

  if (state.status === 'active') {
    const billing = intervalLabel(state.interval)
    const renews = formatDate(state.currentPeriodEnd)
    return (
      <div
        className="billing-plan-modal__panel"
        data-billing-status="active"
        data-billing-interval={state.interval ?? 'unknown'}
      >
        <div className="billing-plan-modal__header-row">
          <div>
            <p className="billing-plan-modal__eyebrow">Current plan</p>
            <h3 className="billing-plan-modal__headline">{planLabel(state.planCode)}</h3>
          </div>
          <StatusPill label="Active" tone="ok" />
        </div>
        <div className="billing-plan-modal__meta">
          {billing ? <MetaRow label="Billing" value={billing} /> : null}
          {renews ? <MetaRow label="Renews" value={renews} /> : null}
        </div>
        <QuotaUsageRows quota={state.quota} />
        <p className="billing-plan-modal__footnote">Subscription management opens in a later step.</p>
      </div>
    )
  }

  if (state.status === 'canceling') {
    const through = formatDate(state.accessThrough)
    return (
      <div className="billing-plan-modal__panel" data-billing-status="canceling">
        <div className="billing-plan-modal__header-row">
          <div>
            <p className="billing-plan-modal__eyebrow">Current plan</p>
            <h3 className="billing-plan-modal__headline">{planLabel(state.planCode)}</h3>
          </div>
          <StatusPill label="Cancellation scheduled" tone="warn" />
        </div>
        <p className="billing-plan-modal__copy">
          {through
            ? `Access remains available through ${through}.`
            : 'Access remains available through the end of the current billing period.'}
        </p>
        <QuotaUsageRows quota={state.quota} />
      </div>
    )
  }

  if (state.status === 'past_due') {
    const grace = formatDate(state.graceUntil)
    return (
      <div className="billing-plan-modal__panel" data-billing-status="past_due">
        <div className="billing-plan-modal__header-row">
          <div>
            <p className="billing-plan-modal__eyebrow">Current plan</p>
            <h3 className="billing-plan-modal__headline">{planLabel(state.planCode)}</h3>
          </div>
          <StatusPill label="Payment issue" tone="danger" />
        </div>
        <p className="billing-plan-modal__copy">
          {state.accessActive
            ? 'Your subscription has a payment issue, but access is still active.'
            : 'Your subscription has a payment issue and access is currently limited.'}
          {grace ? ` Grace period through ${grace}.` : null}
        </p>
        <div className="billing-plan-modal__meta">
          <MetaRow label="Access" value={state.accessActive ? 'Active' : 'Limited'} />
          {grace ? <MetaRow label="Grace until" value={grace} /> : null}
        </div>
        <QuotaUsageRows quota={state.quota} />
      </div>
    )
  }

  // expired
  return (
    <div className="billing-plan-modal__panel" data-billing-status="expired">
      <div className="billing-plan-modal__header-row">
        <div>
          <p className="billing-plan-modal__eyebrow">Subscription</p>
          <h3 className="billing-plan-modal__headline">Inactive</h3>
        </div>
        <StatusPill label="Ended" tone="neutral" />
      </div>
      <p className="billing-plan-modal__copy">
        {state.planCode
          ? `Your ${planLabel(state.planCode)} subscription is no longer active.`
          : 'Your subscription is no longer active.'}{' '}
        You still have Free access with the quotas below.
      </p>
      <QuotaUsageRows quota={state.quota} />
    </div>
  )
}

function BillingPlanModalFrame({
  open,
  onClose,
  billing,
}: {
  open: boolean
  onClose: () => void
  billing: UseBillingResult
}) {
  const t = designTokens
  const titleId = useId()
  const [previewInterval, setPreviewInterval] = useState<NormalizedBillingInterval>('monthly')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => handleBillingModalEscape(e, onClose)
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

  const loadBilling = billing.actions.load
  useEffect(() => {
    if (!open) return
    void loadBilling()
  }, [open, loadBilling])

  if (!open) return null

  const busy = billing.state.status === 'loading' || billing.loading

  return (
    <div
      className="ds-root billing-plan-modal__overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: `${t.spacing[6]}px`,
        boxSizing: 'border-box',
        overflow: 'hidden',
        overscrollBehavior: 'contain',
      }}
      role="presentation"
      data-testid="billing-plan-overlay"
      onMouseDown={(e: ReactMouseEvent<HTMLDivElement>) => handleBillingModalOverlayMouseDown(e, onClose)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        className="ds-card billing-plan-modal__dialog"
        data-testid="billing-plan-dialog"
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
        <div className="billing-plan-modal__titlebar">
          <h2 id={titleId} className="billing-plan-modal__title">
            Plan &amp; billing
          </h2>
          <button type="button" className="billing-plan-modal__close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="billing-plan-modal__body">
          <BillingPlanContent
            state={billing.state}
            onRetry={
              billing.state.status === 'unavailable'
                ? () => {
                    void billing.actions.load()
                  }
                : undefined
            }
            previewInterval={previewInterval}
            onPreviewIntervalChange={setPreviewInterval}
          />
          {billing.error && billing.state.status !== 'unavailable' ? (
            <p className="billing-plan-modal__action-error" role="status">
              {billing.error.message}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function BillingPlanModalConnected({ open, onClose }: { open: boolean; onClose: () => void }) {
  const billing = useBilling()
  return <BillingPlanModalFrame open={open} onClose={onClose} billing={billing} />
}

export function BillingPlanModal({ open, onClose, billing }: BillingPlanModalProps) {
  if (billing) {
    return <BillingPlanModalFrame open={open} onClose={onClose} billing={billing} />
  }
  return <BillingPlanModalConnected open={open} onClose={onClose} />
}
