/**
 * MetricCard — compact KPI tile used in the metric rows on both pages.
 * Renders a labelled icon, a large value, an optional description, and either a
 * trend chip (Overview) or a dot-status line (Providers).
 */
import type { MetricDatum } from '../data/mockData'
import { GlassCard } from './GlassCard'
import { WatchIcon, type IconName } from './WatchIcons'
import { statusColor } from '../statusColor'

const TREND_ARROW: Record<'up' | 'down' | 'flat', string> = {
  up: '↑',
  down: '↓',
  flat: '→',
}

export function MetricCard({ metric }: { metric: MetricDatum }) {
  const { label, icon, value, description, status, trend } = metric
  return (
    <GlassCard>
      <div className="yw-metric__top">
        <span className="yw-metric__label">{label}</span>
        <span className="yw-metric__icon">
          <WatchIcon name={icon as IconName} size={17} />
        </span>
      </div>

      <div className="yw-metric__value">{value}</div>
      {description && <p className="yw-metric__desc">{description}</p>}

      {trend && (
        <div className="yw-metric__foot">
          <span className={`yw-metric__trend is-${trend.direction}`}>
            {TREND_ARROW[trend.direction]} {trend.value}
          </span>
          {trend.note && <span className="yw-metric__trend-note">{trend.note}</span>}
        </div>
      )}

      {status && (
        <div className="yw-metric__foot">
          <span className="yw-dotline" style={{ color: statusColor(status.kind) }}>
            <span className="yw-dotline__dot" style={{ background: 'currentColor' }} />
            {status.label}
          </span>
        </div>
      )}
    </GlassCard>
  )
}
