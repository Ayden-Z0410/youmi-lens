/**
 * SecuritySettings — read-only security posture summary for the Settings page,
 * plus a soft warning reminding that AdminGate must be replaced with a
 * server-verified admin check before real data is connected. Display only.
 */
import type { SecurityItem } from '../data/mockData'
import { GlassCard } from './GlassCard'
import { WatchIcon } from './WatchIcons'

export function SecuritySettings({
  items,
  note,
}: {
  items: SecurityItem[]
  note: string
}) {
  return (
    <GlassCard title="Security" subtitle="Dashboard access & data posture">
      <div className="yw-detail">
        {items.map((item) => (
          <div key={item.id} className="yw-detail-row">
            <span className="yw-detail-row__label">{item.label}</span>
            <span className="yw-detail-row__value">{item.value}</span>
          </div>
        ))}
      </div>

      <div className="yw-callout">
        <span className="yw-callout__icon">
          <WatchIcon name="shield" size={17} />
        </span>
        <p className="yw-callout__text">{note}</p>
      </div>
    </GlassCard>
  )
}
