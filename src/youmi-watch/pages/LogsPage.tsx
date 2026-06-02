/**
 * LogsPage — provider events, API requests, system activity, and failed
 * operations. Reuses the shared Youmi Watch layout, header, metric row, and
 * glass cards/table primitives for full visual consistency. Mock data only.
 *
 * Layout: metric row → Log Filters → Event Logs (full width, 8-column table) →
 * Selected Log Details + System Health split.
 */
import { YoumiWatchHeader } from '../components/YoumiWatchHeader'
import { MetricCard } from '../components/MetricCard'
import { LogFilters } from '../components/LogFilters'
import { EventLogs } from '../components/EventLogs'
import { LogDetailPanel } from '../components/LogDetailPanel'
import { SystemHealthCard } from '../components/SystemHealthCard'
import {
  logMetrics,
  logFilters,
  logRows,
  selectedLogDetail,
  systemHealth,
} from '../data/mockData'

export function LogsPage({ onRefresh }: { onRefresh?: () => void }) {
  return (
    <>
      <YoumiWatchHeader
        title="Logs"
        subtitle="Search provider events, API requests, system activity, and failed operations."
        onRefresh={onRefresh}
      />

      <div className="yw-metrics">
        {logMetrics.map((metric) => (
          <MetricCard key={metric.id} metric={metric} />
        ))}
      </div>

      <LogFilters filters={logFilters} />

      <EventLogs rows={logRows} />

      <div className="yw-grid-2">
        <LogDetailPanel detail={selectedLogDetail} />
        <SystemHealthCard items={systemHealth} />
      </div>
    </>
  )
}
