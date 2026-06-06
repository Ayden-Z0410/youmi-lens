/**
 * ProvidersPage — connected services, quotas, API health and status. Fetches
 * /api/admin/watch/providers with local mock fallback. Layout/styling unchanged.
 */
import { YoumiWatchHeader } from '../components/YoumiWatchHeader'
import { MetricCard } from '../components/MetricCard'
import { GlassCard } from '../components/GlassCard'
import { ProviderCard } from '../components/ProviderCard'
import { TrendChart } from '../components/TrendChart'
import { StatusBadge } from '../components/StatusBadge'
import { WatchIcon, type IconName } from '../components/WatchIcons'
import { useWatchPageData } from '../hooks/useWatchPageData'
import type { ProvidersPayload } from '../types/api'
import {
  providerMetrics,
  providers,
  providerUsageTrend,
  connectionHealth,
} from '../data/mockData'

const FALLBACK: ProvidersPayload = {
  metrics: providerMetrics,
  providers,
  usageTrend: providerUsageTrend,
  connectionHealth,
}

export function ProvidersPage() {
  const { data, source, coverage, loading, unauthorized, refresh } =
    useWatchPageData<ProvidersPayload>('providers', FALLBACK)

  return (
    <>
      <YoumiWatchHeader
        title="Providers"
        subtitle="Monitor connected services, quotas, API health, and provider status."
        onRefresh={refresh}
        source={source}
        coverage={coverage}
        dataLoading={loading}
        unauthorized={unauthorized}
      />

      <div className="yw-metrics">
        {data.metrics.map((metric) => (
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
          {data.providers.map((provider) => (
            <ProviderCard key={provider.id} provider={provider} />
          ))}
        </div>
      </GlassCard>

      <div className="yw-grid-2">
        <GlassCard title="Provider Usage Trend" subtitle="API call volume by service">
          <TrendChart data={data.usageTrend} />
        </GlassCard>

        <GlassCard title="Connection Health" subtitle="Live latency & status">
          <div className="yw-health-list">
            {data.connectionHealth.map((conn) => (
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
