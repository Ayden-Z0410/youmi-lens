/**
 * ProvidersPage — connected services, quotas, API health and status. Built from
 * the Stitch Providers reference, reusing the Overview page's shared layout,
 * header, metric row, glass cards and chart for visual consistency. Mock data
 * only — "Add Provider" / "View Details" are presentational placeholders.
 */
import { YoumiWatchHeader } from '../components/YoumiWatchHeader'
import { MetricCard } from '../components/MetricCard'
import { GlassCard } from '../components/GlassCard'
import { ProviderCard } from '../components/ProviderCard'
import { TrendChart } from '../components/TrendChart'
import { StatusBadge } from '../components/StatusBadge'
import { WatchIcon, type IconName } from '../components/WatchIcons'
import {
  providerMetrics,
  providers,
  providerUsageTrend,
  connectionHealth,
} from '../data/mockData'

export function ProvidersPage({ onRefresh }: { onRefresh?: () => void }) {
  return (
    <>
      <YoumiWatchHeader
        title="Providers"
        subtitle="Monitor connected services, quotas, API health, and provider status."
        onRefresh={onRefresh}
      />

      <div className="yw-metrics">
        {providerMetrics.map((metric) => (
          <MetricCard key={metric.id} metric={metric} />
        ))}
      </div>

      <GlassCard
        title="Connected Providers"
        subtitle="Services powering transcription, summaries, hosting and storage"
        action={
          <button type="button" className="yw-btn yw-btn--primary">
            <WatchIcon name="link" size={16} />
            Add Provider
          </button>
        }
      >
        <div className="yw-provider-list">
          {providers.map((provider) => (
            <ProviderCard key={provider.id} provider={provider} />
          ))}
        </div>
      </GlassCard>

      <div className="yw-grid-2">
        <GlassCard title="Provider Usage Trend" subtitle="API call volume by service">
          <TrendChart data={providerUsageTrend} />
        </GlassCard>

        <GlassCard title="Connection Health" subtitle="Live latency & status">
          <div className="yw-health-list">
            {connectionHealth.map((conn) => (
              <div key={conn.id} className="yw-health">
                <span className="yw-health__logo">
                  <WatchIcon name={conn.icon as IconName} size={16} />
                </span>
                <div>
                  <div className="yw-health__name">{conn.name}</div>
                  <div className="yw-health__latency">{conn.latency}</div>
                </div>
                <span className="yw-health__spacer" />
                <StatusBadge status={conn.status} label={conn.statusLabel} />
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </>
  )
}
