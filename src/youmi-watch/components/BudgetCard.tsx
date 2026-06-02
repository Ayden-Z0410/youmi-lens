/**
 * BudgetCard — monthly budget summary with a usage meter and a status pill.
 * Reuses the shared glass card, meter, detail rows, and StatusBadge so it reads
 * as the same product as the rest of Youmi Watch. Mock data only.
 */
import type { BudgetSummary } from '../data/mockData'
import { GlassCard } from './GlassCard'
import { StatusBadge } from './StatusBadge'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="yw-detail-row">
      <span className="yw-detail-row__label">{label}</span>
      <span className="yw-detail-row__value">{value}</span>
    </div>
  )
}

export function BudgetCard({ budget }: { budget: BudgetSummary }) {
  const pct = Math.min(100, Math.max(0, budget.usagePercent))
  return (
    <GlassCard title="Monthly Budget" subtitle="Spend against the monthly cap">
      <div className="yw-budget__head">
        <div className="yw-budget__usage">
          <span className="yw-budget__pct">{budget.usagePercent}%</span>
          <span className="yw-budget__of">of {budget.monthlyBudget} used</span>
        </div>
        <StatusBadge status={budget.status} label={budget.statusLabel} />
      </div>

      <div className="yw-meter" aria-hidden>
        <div className="yw-meter__fill" style={{ width: `${pct}%` }} />
      </div>

      <div className="yw-detail" style={{ marginTop: 16 }}>
        <Row label="Monthly budget" value={budget.monthlyBudget} />
        <Row label="Current spend" value={budget.currentSpend} />
        <Row label="Remaining" value={budget.remaining} />
      </div>
    </GlassCard>
  )
}
