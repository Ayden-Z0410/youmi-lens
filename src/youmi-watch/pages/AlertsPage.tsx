/**
 * AlertsPage — provider warnings, cost spikes, and infrastructure incidents.
 * Fetches /api/admin/watch/alerts with local mock fallback. Layout unchanged.
 */
import { YoumiWatchHeader } from '../components/YoumiWatchHeader'
import { MetricCard } from '../components/MetricCard'
import { AlertCenter } from '../components/AlertCenter'
import { AlertRules } from '../components/AlertRules'
import { AlertDetailPanel } from '../components/AlertDetailPanel'
import { useWatchPageData } from '../hooks/useWatchPageData'
import type { AlertsPayload } from '../types/api'
import { alertMetrics, alertRows, alertRules, selectedAlertDetail } from '../data/mockData'

const FALLBACK: AlertsPayload = {
  metrics: alertMetrics,
  rows: alertRows,
  rules: alertRules,
  selectedDetail: selectedAlertDetail,
}

export function AlertsPage() {
  const { data, source, loading, unauthorized, refresh } = useWatchPageData<AlertsPayload>(
    'alerts',
    FALLBACK,
  )

  return (
    <>
      <YoumiWatchHeader
        title="Alerts"
        subtitle="Track provider warnings, cost spikes, and infrastructure incidents."
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

      <AlertCenter rows={data.rows} rules={data.rules} />

      <div className="yw-grid-2">
        <AlertRules rules={data.rules} />
        <AlertDetailPanel detail={data.selectedDetail} />
      </div>
    </>
  )
}
