/**
 * EventLogs — the main provider/event log table. Reuses the shared glass-table
 * primitives (.yw-table / .yw-trow / .yw-tcell) for consistency with the Alerts
 * and Costs tables. Soft status/severity badges and a code-style request-ID
 * chip — deliberately not a flat admin table. Mock data only.
 */
import type { LogRow } from '../data/mockData'
import { GlassCard } from './GlassCard'
import { StatusBadge } from './StatusBadge'

export function EventLogs({ rows }: { rows: LogRow[] }) {
  return (
    <GlassCard
      className="yw-spaced"
      title="Event Logs"
      subtitle="Provider events, API requests, and system activity"
    >
      <div className="yw-table yw-logs-table">
        <div className="yw-trow yw-trow--head">
          <span className="yw-tcell">Time</span>
          <span className="yw-tcell">Provider</span>
          <span className="yw-tcell">Event</span>
          <span className="yw-tcell">Status</span>
          <span className="yw-tcell">Severity</span>
          <span className="yw-tcell">Latency</span>
          <span className="yw-tcell">Cost</span>
          <span className="yw-tcell yw-tcell--end">Request ID</span>
        </div>
        {rows.map((row) => (
          <div key={row.id} className="yw-trow">
            <span className="yw-tcell yw-tcell--muted">{row.time}</span>
            <span className="yw-tcell yw-tcell--strong">{row.provider}</span>
            <span className="yw-tcell">{row.event}</span>
            <span className="yw-tcell">
              <StatusBadge status={row.status} label={row.statusLabel} />
            </span>
            <span className="yw-tcell">
              <StatusBadge status={row.severity} label={row.severityLabel} dot={false} />
            </span>
            <span className="yw-tcell yw-tcell--muted">{row.latency}</span>
            <span className="yw-tcell yw-tcell--strong">{row.cost}</span>
            <span className="yw-tcell yw-tcell--end">
              <span className="yw-code">{row.requestId}</span>
            </span>
          </div>
        ))}
      </div>
    </GlassCard>
  )
}
