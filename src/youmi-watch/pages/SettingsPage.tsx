/**
 * SettingsPage — provider connections, alert thresholds, notifications,
 * dashboard security, and appearance. Fetches /api/admin/watch/settings with
 * local mock fallback. Layout unchanged.
 *
 * SECURITY: credentials are always masked placeholders (never real keys); the
 * server endpoint returns masked values only.
 */
import { YoumiWatchHeader } from '../components/YoumiWatchHeader'
import { MetricCard } from '../components/MetricCard'
import { ProviderConnections } from '../components/ProviderConnections'
import { AlertThresholds } from '../components/AlertThresholds'
import { NotificationSettings } from '../components/NotificationSettings'
import { SecuritySettings } from '../components/SecuritySettings'
import { AppearanceSettings } from '../components/AppearanceSettings'
import { useWatchPageData } from '../hooks/useWatchPageData'
import type { SettingsPayload } from '../types/api'
import {
  settingsMetrics,
  providerConnections,
  alertThresholds,
  notificationSettings,
  securitySettings,
  securityNote,
  appearanceSettings,
} from '../data/mockData'

const FALLBACK: SettingsPayload = {
  metrics: settingsMetrics,
  providerConnections,
  alertThresholds,
  notifications: notificationSettings,
  security: securitySettings,
  securityNote,
  appearance: appearanceSettings,
}

export function SettingsPage() {
  const { data, source, loading, unauthorized, refresh } = useWatchPageData<SettingsPayload>(
    'settings',
    FALLBACK,
  )

  return (
    <>
      <YoumiWatchHeader
        title="Settings"
        subtitle="Manage provider connections, alert thresholds, notifications, and dashboard security."
        onRefresh={refresh}
        source={source}
        dataLoading={loading}
        unauthorized={unauthorized}
      />

      <div className="yw-metrics">
        {data.metrics.map((metric) => (
          <MetricCard key={metric.id} metric={metric} />
        ))}
      </div>

      <ProviderConnections rows={data.providerConnections} />

      <div className="yw-grid-2">
        <AlertThresholds rows={data.alertThresholds} />
        <NotificationSettings rows={data.notifications} />
      </div>

      <div className="yw-grid-2">
        <SecuritySettings items={data.security} note={data.securityNote} />
        <AppearanceSettings options={data.appearance} />
      </div>
    </>
  )
}
