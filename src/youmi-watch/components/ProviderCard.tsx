/**
 * ProviderCard — a single connected-provider row inside the Providers list.
 * Layout (desktop): logo + name/kind · status badge · usage · cost · health ·
 * "View Details". Mirrors the Stitch reference row, adapted to the shared glass
 * design system.
 */
import type { ProviderDatum } from '../data/mockData'
import { WatchIcon, type IconName } from './WatchIcons'
import { StatusBadge } from './StatusBadge'

export interface ProviderCardProps {
  provider: ProviderDatum
  onViewDetails?: (id: string) => void
}

export function ProviderCard({ provider, onViewDetails }: ProviderCardProps) {
  const { id, name, kind, icon, status, statusLabel, usage, usageNote, cost, health, healthNote, dataState } =
    provider
  return (
    <div className="yw-provider">
      <div className="yw-provider__id">
        <span className="yw-provider__logo">
          <WatchIcon name={icon as IconName} size={19} />
        </span>
        <div>
          <div className="yw-provider__name">{name}</div>
          <div className="yw-provider__kind">{kind}</div>
          {dataState && dataState !== 'mock' && (
            <span className={`yw-rowstate yw-rowstate--${dataState}`}>
              <span className="yw-rowstate__dot" />
              {dataState === 'live' ? 'Live' : 'No data'}
            </span>
          )}
        </div>
      </div>

      <StatusBadge status={status} label={statusLabel} />

      <div>
        <div className="yw-provider__metric-label">Usage</div>
        <div className="yw-provider__metric-value">
          {usage}
          {usageNote && <small>{usageNote}</small>}
        </div>
      </div>

      <div>
        <div className="yw-provider__metric-label">Cost</div>
        <div className="yw-provider__metric-value">{cost}</div>
      </div>

      <div>
        <div className="yw-provider__metric-label">Health</div>
        <div className="yw-provider__metric-value">
          {health}
          {healthNote && <small>{healthNote}</small>}
        </div>
      </div>

      <button type="button" className="yw-btn yw-btn--ghost" onClick={() => onViewDetails?.(id)}>
        View Details
      </button>
    </div>
  )
}
