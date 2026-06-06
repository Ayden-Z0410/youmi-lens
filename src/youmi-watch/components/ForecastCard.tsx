/**
 * ForecastCard — "Month-End Forecast" detail card. Summarises projected cost,
 * remaining budget after the forecast, a risk badge, and a suggested action.
 * Reuses the shared detail-row / detail-block styling from the Alerts page.
 */
import type { ReactNode } from 'react'
import type { CostForecast } from '../data/mockData'
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

export function ForecastCard({ forecast }: { forecast: CostForecast }) {
  return (
    <GlassCard title="Month-End Forecast" subtitle="Projected spend & risk">
      <div className="yw-detail">
        <DetailRow label="Projected cost" value={forecast.projectedCost} />
        <DetailRow label="Budget remaining after forecast" value={forecast.budgetRemainingAfter} />
        <DetailRow
          label="Risk level"
          value={<StatusBadge status={forecast.riskStatus} label={forecast.riskLevel} />}
        />

        <div className="yw-detail-block">
          <span className="yw-detail-row__label">Suggested action</span>
          <p className="yw-detail-block__text">{forecast.suggestedAction}</p>
        </div>

        {forecast.reliable === false && (
          <p className="yw-detail-block__text yw-detail-block__text--muted">
            Forecast is an estimate only — cost data does not yet cover all providers.
          </p>
        )}
      </div>
    </GlassCard>
  )
}
