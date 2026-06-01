/**
 * AlertDetailPanel — "Selected Alert Details" card. Summarises the currently
 * focused alert (provider, trigger, related metric with an inline meter, and a
 * suggested action) and offers Acknowledge / View Logs actions. Presentational
 * only for now (mock data).
 */
import type { AlertDetail } from '../data/mockData'
import { GlassCard } from './GlassCard'

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="yw-detail-row">
      <span className="yw-detail-row__label">{label}</span>
      <span className="yw-detail-row__value">{value}</span>
    </div>
  )
}

export function AlertDetailPanel({ detail }: { detail: AlertDetail }) {
  return (
    <GlassCard title="Selected Alert Details" subtitle="Focused alert context">
      <div className="yw-detail">
        <DetailRow label="Provider" value={detail.provider} />
        <DetailRow label="Trigger" value={detail.trigger} />

        <div className="yw-detail-row">
          <span className="yw-detail-row__label">Related metric</span>
          <span className="yw-detail-row__value">{detail.relatedMetric}</span>
        </div>
        {detail.relatedPercent != null && (
          <div className="yw-meter" aria-hidden>
            <div
              className="yw-meter__fill"
              style={{ width: `${Math.min(100, Math.max(0, detail.relatedPercent))}%` }}
            />
          </div>
        )}

        <div className="yw-detail-block">
          <span className="yw-detail-row__label">Suggested action</span>
          <p className="yw-detail-block__text">{detail.suggestedAction}</p>
        </div>
      </div>

      <div className="yw-detail-actions">
        <button type="button" className="yw-btn yw-btn--primary">
          Acknowledge Alert
        </button>
        <button type="button" className="yw-btn yw-btn--secondary">
          View Logs
        </button>
      </div>
    </GlassCard>
  )
}
