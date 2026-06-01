/**
 * AlertsPage — provider warnings, cost spikes, and infrastructure incidents.
 * Reuses the shared Youmi Watch layout, header, metric row, and glass cards for
 * full visual consistency with Overview and Providers. Mock data only.
 *
 * Layout: metric row → Alert Center (full width, for the 7-column table) →
 * Alert Rules + Selected Alert Details split.
 */
import { YoumiWatchHeader } from '../components/YoumiWatchHeader'
import { MetricCard } from '../components/MetricCard'
import { AlertCenter } from '../components/AlertCenter'
import { AlertRules } from '../components/AlertRules'
import { AlertDetailPanel } from '../components/AlertDetailPanel'
import {
  alertMetrics,
  alertRows,
  alertRules,
  selectedAlertDetail,
} from '../data/mockData'

export function AlertsPage({ onRefresh }: { onRefresh?: () => void }) {
  return (
    <>
      <YoumiWatchHeader
        title="Alerts"
        subtitle="Track provider warnings, cost spikes, and infrastructure incidents."
        onRefresh={onRefresh}
      />

      <div className="yw-metrics">
        {alertMetrics.map((metric) => (
          <MetricCard key={metric.id} metric={metric} />
        ))}
      </div>

      <AlertCenter rows={alertRows} rules={alertRules} />

      <div className="yw-grid-2">
        <AlertRules rules={alertRules} />
        <AlertDetailPanel detail={selectedAlertDetail} />
      </div>
    </>
  )
}
