/**
 * OverviewPage — platform-wide health & usage summary. Primary visual source is
 * the Stitch reference's structure: a metric row, a usage trend + alerts split,
 * and a recent-activity feed. Mock data only.
 */
import { YoumiWatchHeader } from '../components/YoumiWatchHeader'
import { MetricCard } from '../components/MetricCard'
import { GlassCard } from '../components/GlassCard'
import { TrendChart } from '../components/TrendChart'
import { AlertsPanel } from '../components/AlertsPanel'
import { RecentActivity } from '../components/RecentActivity'
import {
  overviewMetrics,
  overviewUsageTrend,
  overviewAlerts,
  overviewActivity,
} from '../data/mockData'

export function OverviewPage({ onRefresh }: { onRefresh?: () => void }) {
  return (
    <>
      <YoumiWatchHeader
        title="Overview"
        subtitle="Real-time health and usage across the Youmi Lens platform."
        onRefresh={onRefresh}
      />

      <div className="yw-metrics">
        {overviewMetrics.map((metric) => (
          <MetricCard key={metric.id} metric={metric} />
        ))}
      </div>

      <div className="yw-grid-2">
        <GlassCard title="Usage Trend" subtitle="Volume by activity over the last 7 days">
          <TrendChart data={overviewUsageTrend} />
        </GlassCard>
        <AlertsPanel alerts={overviewAlerts} title="Active Alerts" subtitle="Needs attention" />
      </div>

      <RecentActivity items={overviewActivity} subtitle="Latest platform events" />
    </>
  )
}
