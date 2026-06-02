/**
 * NotificationSettings — notification channel list for the Settings page.
 * Connectable channels (email, desktop) show a toggle; not-yet-available
 * channels show a soft "Not connected" badge. No real notifications are sent —
 * mock state only.
 */
import type { NotificationRow } from '../data/mockData'
import { GlassCard } from './GlassCard'
import { StatusBadge } from './StatusBadge'
import { ToggleSwitch } from './ToggleSwitch'

export function NotificationSettings({ rows }: { rows: NotificationRow[] }) {
  return (
    <GlassCard title="Notifications" subtitle="Where alerts are delivered">
      <div className="yw-settings-list">
        {rows.map((row) => (
          <div key={row.id} className="yw-setting-row">
            <span className="yw-setting-row__main">
              <span className="yw-setting-row__label">{row.channel}</span>
              <span className="yw-setting-row__detail">{row.detail}</span>
            </span>
            <span className="yw-setting-row__control">
              {row.enabled === null ? (
                <StatusBadge status="neutral" label="Not connected" />
              ) : (
                <ToggleSwitch on={row.enabled} label={row.channel} />
              )}
            </span>
          </div>
        ))}
      </div>
    </GlassCard>
  )
}
