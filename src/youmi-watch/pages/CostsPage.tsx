/**
 * CostsPage — estimated spend across AI models, email, hosting, and storage.
 * Reuses the shared Youmi Watch layout, header, metric row, glass cards, and the
 * existing TrendChart for full visual consistency with the other pages. Mock
 * data only — no real provider billing APIs.
 *
 * Layout: metric row → Cost Trend (full width) → Distribution + Budget split →
 * Cost Breakdown + Month-End Forecast split.
 */
import { YoumiWatchHeader } from '../components/YoumiWatchHeader'
import { MetricCard } from '../components/MetricCard'
import { GlassCard } from '../components/GlassCard'
import { TrendChart } from '../components/TrendChart'
import { CostDistribution } from '../components/CostDistribution'
import { BudgetCard } from '../components/BudgetCard'
import { CostBreakdown } from '../components/CostBreakdown'
import { ForecastCard } from '../components/ForecastCard'
import {
  costMetrics,
  costTrend,
  costDistribution,
  budgetSummary,
  costBreakdown,
  costForecast,
} from '../data/mockData'

export function CostsPage({ onRefresh }: { onRefresh?: () => void }) {
  return (
    <>
      <YoumiWatchHeader
        title="Costs"
        subtitle="Track estimated spending across AI models, email, hosting, and storage."
        onRefresh={onRefresh}
      />

      <div className="yw-metrics">
        {costMetrics.map((metric) => (
          <MetricCard key={metric.id} metric={metric} />
        ))}
      </div>

      <GlassCard
        className="yw-spaced"
        title="Cost Trend"
        subtitle="Estimated daily spend by provider over the last 7 days"
      >
        <TrendChart data={costTrend} />
      </GlassCard>

      <div className="yw-grid-2">
        <CostDistribution slices={costDistribution} centerValue={budgetSummary.currentSpend} />
        <BudgetCard budget={budgetSummary} />
      </div>

      <div className="yw-grid-2">
        <CostBreakdown rows={costBreakdown} />
        <ForecastCard forecast={costForecast} />
      </div>
    </>
  )
}
