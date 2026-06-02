/**
 * CostBreakdown — per-provider cost table. Reuses the shared glass-table
 * primitives (.yw-table / .yw-trow / .yw-tcell) used by the Alerts page for a
 * consistent look. The Change column is colour-coded (amber up = more spend,
 * green down = less spend). Mock data only.
 */
import type { CostBreakdownRow } from '../data/mockData'
import { GlassCard } from './GlassCard'
import { StatusBadge } from './StatusBadge'

export function CostBreakdown({ rows }: { rows: CostBreakdownRow[] }) {
  return (
    <GlassCard title="Cost Breakdown" subtitle="Estimated spend by provider this month">
      <div className="yw-table yw-cost-table">
        <div className="yw-trow yw-trow--head">
          <span className="yw-tcell">Provider</span>
          <span className="yw-tcell">Usage</span>
          <span className="yw-tcell">Unit</span>
          <span className="yw-tcell">Estimated Cost</span>
          <span className="yw-tcell">Change</span>
          <span className="yw-tcell yw-tcell--end">Status</span>
        </div>
        {rows.map((row) => (
          <div key={row.id} className="yw-trow">
            <span className="yw-tcell yw-tcell--strong">{row.provider}</span>
            <span className="yw-tcell">{row.usage}</span>
            <span className="yw-tcell yw-tcell--muted">{row.unit}</span>
            <span className="yw-tcell yw-tcell--strong">{row.estimatedCost}</span>
            <span className="yw-tcell">
              <span className={`yw-change is-${row.changeDir}`}>
                {row.changeDir === 'up' ? '↑' : '↓'} {row.change.replace(/^[+-]/, '')}
              </span>
            </span>
            <span className="yw-tcell yw-tcell--end">
              <StatusBadge status={row.status} label={row.statusLabel} />
            </span>
          </div>
        ))}
      </div>
    </GlassCard>
  )
}
