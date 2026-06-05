/**
 * LogsPage — provider events, API requests, system activity, and failed
 * operations. Fetches /api/admin/watch/logs with local mock fallback. Layout
 * unchanged.
 */
import { YoumiWatchHeader } from '../components/YoumiWatchHeader'
import { MetricCard } from '../components/MetricCard'
import { LogFilters } from '../components/LogFilters'
import { EventLogs } from '../components/EventLogs'
import { LogDetailPanel } from '../components/LogDetailPanel'
import { SystemHealthCard } from '../components/SystemHealthCard'
import { useWatchPageData } from '../hooks/useWatchPageData'
import type { LogsPayload } from '../types/api'
import {
  logMetrics,
  logFilters,
  logRows,
  selectedLogDetail,
  systemHealth,
} from '../data/mockData'

const FALLBACK: LogsPayload = {
  metrics: logMetrics,
  filters: logFilters,
  rows: logRows,
  selectedDetail: selectedLogDetail,
  systemHealth,
}

export function LogsPage() {
  const { data, source, loading, unauthorized, refresh } = useWatchPageData<LogsPayload>(
    'logs',
    FALLBACK,
  )

  return (
    <>
      <YoumiWatchHeader
        title="Logs"
        subtitle="Search provider events, API requests, system activity, and failed operations."
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

      <LogFilters filters={data.filters} />

      <EventLogs rows={data.rows} />

      <div className="yw-grid-2">
        <LogDetailPanel detail={data.selectedDetail} />
        <SystemHealthCard items={data.systemHealth} />
      </div>
    </>
  )
}
