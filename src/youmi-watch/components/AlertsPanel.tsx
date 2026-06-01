/**
 * AlertsPanel — list of recent system alerts with severity-coloured icons.
 * Severity drives both the icon glyph and its tinted background.
 */
import type { AlertDatum } from '../data/mockData'
import { GlassCard } from './GlassCard'
import { WatchIcon, type IconName } from './WatchIcons'

const SEVERITY_ICON: Record<AlertDatum['severity'], IconName> = {
  warning: 'alert',
  error: 'alert',
  info: 'sparkles',
  success: 'check-circle',
}

export interface AlertsPanelProps {
  alerts: AlertDatum[]
  title?: string
  subtitle?: string
}

export function AlertsPanel({ alerts, title = 'Alerts', subtitle }: AlertsPanelProps) {
  return (
    <GlassCard title={title} subtitle={subtitle}>
      <div className="yw-alert-list">
        {alerts.map((alert) => (
          <div key={alert.id} className="yw-alert">
            <span className={`yw-alert__icon is-${alert.severity}`}>
              <WatchIcon name={SEVERITY_ICON[alert.severity]} size={16} />
            </span>
            <div>
              <div className="yw-alert__title">{alert.title}</div>
              <div className="yw-alert__detail">{alert.detail}</div>
              <div className="yw-alert__time">{alert.time}</div>
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  )
}
