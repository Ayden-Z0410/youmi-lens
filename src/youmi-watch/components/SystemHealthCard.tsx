/**
 * SystemHealthCard — compact status list for the Logs page. Each subsystem shows
 * a soft status badge ("Active" vs "Mock mode"), reusing the shared detail-row
 * layout and StatusBadge. Mock data only.
 */
import type { SystemHealthItem } from '../data/mockData'
import { GlassCard } from './GlassCard'
import { StatusBadge } from './StatusBadge'

export function SystemHealthCard({ items }: { items: SystemHealthItem[] }) {
  return (
    <GlassCard title="System Health" subtitle="Watch subsystem status">
      <div className="yw-detail">
        {items.map((item) => (
          <div key={item.id} className="yw-detail-row">
            <span className="yw-detail-row__label">{item.label}</span>
            <span className="yw-detail-row__value">
              <StatusBadge status={item.status} label={item.state} />
            </span>
          </div>
        ))}
      </div>
    </GlassCard>
  )
}
