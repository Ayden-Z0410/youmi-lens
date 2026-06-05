/**
 * OverviewPage — platform-wide health & usage summary. Fetches
 * /api/admin/watch/overview (after AdminGate) and falls back to the local mock
 * data if the endpoint is unavailable. Layout/styling unchanged.
 */
import { YoumiWatchHeader } from '../components/YoumiWatchHeader'
import { MetricCard } from '../components/MetricCard'
import { GlassCard } from '../components/GlassCard'
import { TrendChart } from '../components/TrendChart'
import { AlertsPanel } from '../components/AlertsPanel'
import { RecentActivity } from '../components/RecentActivity'
import { useWatchPageData } from '../hooks/useWatchPageData'
import type { OverviewPayload } from '../types/api'
import {
  overviewMetrics,
  overviewUsageTrend,
  overviewAlerts,
  overviewActivity,
} from '../data/mockData'

const FALLBACK: OverviewPayload = {
  metrics: overviewMetrics,
  usageTrend: overviewUsageTrend,
  alerts: overviewAlerts,
  activity: overviewActivity,
}

export function OverviewPage() {
  const { data, source, loading, unauthorized, refresh } = useWatchPageData<OverviewPayload>(
    'overview',
    FALLBACK,
  )

  return (
    <>
      <YoumiWatchHeader
        title="Overview"
        subtitle="Real-time health and usage across the Youmi Lens platform."
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

      <div className="yw-grid-2">
        <GlassCard title="Usage Trend" subtitle="Volume by activity over the last 7 days">
          <TrendChart data={data.usageTrend} />
        </GlassCard>
        <AlertsPanel alerts={data.alerts} title="Active Alerts" subtitle="Needs attention" />
      </div>

      <RecentActivity items={data.activity} subtitle="Latest platform events" />
    </>
  )
}
