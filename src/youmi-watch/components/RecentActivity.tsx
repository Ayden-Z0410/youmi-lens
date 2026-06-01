/**
 * RecentActivity — chronological feed of recent platform events. Each row pairs
 * an icon with a short description and a relative timestamp.
 */
import type { ActivityDatum } from '../data/mockData'
import { GlassCard } from './GlassCard'
import { WatchIcon, type IconName } from './WatchIcons'

export interface RecentActivityProps {
  items: ActivityDatum[]
  title?: string
  subtitle?: string
}

export function RecentActivity({
  items,
  title = 'Recent Activity',
  subtitle,
}: RecentActivityProps) {
  return (
    <GlassCard title={title} subtitle={subtitle}>
      <div className="yw-activity-list">
        {items.map((item) => (
          <div key={item.id} className="yw-activity">
            <span className="yw-activity__icon">
              <WatchIcon name={item.icon as IconName} size={17} />
            </span>
            <span className="yw-activity__text">{item.text}</span>
            <span className="yw-activity__time">{item.time}</span>
          </div>
        ))}
      </div>
    </GlassCard>
  )
}
