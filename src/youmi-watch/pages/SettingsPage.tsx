/**
 * SettingsPage — provider connections, alert thresholds, notifications,
 * dashboard security, and appearance. UI-only with mock data; reuses the shared
 * Youmi Watch layout, header, metric row, and glass cards for full visual
 * consistency.
 *
 * SECURITY: no real API keys, secrets, provider integrations, or backend calls.
 * Credentials are masked placeholders clearly labelled as mock.
 *
 * Layout: metric row → Provider Connections (full width) →
 * Alert Thresholds + Notifications split → Security + Appearance split.
 */
import { YoumiWatchHeader } from '../components/YoumiWatchHeader'
import { MetricCard } from '../components/MetricCard'
import { ProviderConnections } from '../components/ProviderConnections'
import { AlertThresholds } from '../components/AlertThresholds'
import { NotificationSettings } from '../components/NotificationSettings'
import { SecuritySettings } from '../components/SecuritySettings'
import { AppearanceSettings } from '../components/AppearanceSettings'
import {
  settingsMetrics,
  providerConnections,
  alertThresholds,
  notificationSettings,
  securitySettings,
  securityNote,
  appearanceSettings,
} from '../data/mockData'

export function SettingsPage({ onRefresh }: { onRefresh?: () => void }) {
  return (
    <>
      <YoumiWatchHeader
        title="Settings"
        subtitle="Manage provider connections, alert thresholds, notifications, and dashboard security."
        onRefresh={onRefresh}
      />

      <div className="yw-metrics">
        {settingsMetrics.map((metric) => (
          <MetricCard key={metric.id} metric={metric} />
        ))}
      </div>

      <ProviderConnections rows={providerConnections} />

      <div className="yw-grid-2">
        <AlertThresholds rows={alertThresholds} />
        <NotificationSettings rows={notificationSettings} />
      </div>

      <div className="yw-grid-2">
        <SecuritySettings items={securitySettings} note={securityNote} />
        <AppearanceSettings options={appearanceSettings} />
      </div>
    </>
  )
}
