/**
 * LogDetailPanel — "Selected Log Details" card. Shows the focused log event's
 * context (provider, status, request id, related metric/user, retry count) plus
 * a message and suggested action. Reuses the shared detail-row / detail-block /
 * button styling. Buttons are presentational for now (mock data).
 */
import type { ReactNode } from 'react'
import type { LogDetail } from '../data/mockData'
import { GlassCard } from './GlassCard'
import { StatusBadge } from './StatusBadge'

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="yw-detail-row">
      <span className="yw-detail-row__label">{label}</span>
      <span className="yw-detail-row__value">{value}</span>
    </div>
  )
}

export function LogDetailPanel({ detail }: { detail: LogDetail }) {
  return (
    <GlassCard title="Selected Log Details" subtitle="Focused event context">
      <div className="yw-detail">
        <DetailRow label="Provider" value={detail.provider} />
        <DetailRow label="Event" value={detail.event} />
        <DetailRow
          label="Status"
          value={<StatusBadge status={detail.status} label={detail.statusLabel} />}
        />
        <DetailRow label="Request ID" value={<span className="yw-code">{detail.requestId}</span>} />
        <DetailRow label="Related metric" value={<span className="yw-code">{detail.relatedMetric}</span>} />
        <DetailRow label="Related user" value={detail.relatedUser} />
        <DetailRow label="Recording ID" value={detail.recordingId} />
        <DetailRow label="Retry count" value={String(detail.retryCount)} />

        <div className="yw-detail-block">
          <span className="yw-detail-row__label">Message</span>
          <p className="yw-detail-block__text">{detail.message}</p>
        </div>
        <div className="yw-detail-block">
          <span className="yw-detail-row__label">Suggested action</span>
          <p className="yw-detail-block__text">{detail.suggestedAction}</p>
        </div>
      </div>

      <div className="yw-detail-actions">
        <button type="button" className="yw-btn yw-btn--primary">
          View Provider
        </button>
        <button type="button" className="yw-btn yw-btn--secondary">
          Copy Request ID
        </button>
      </div>
    </GlassCard>
  )
}
