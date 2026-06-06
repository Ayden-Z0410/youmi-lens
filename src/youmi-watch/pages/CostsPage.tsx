/**
 * CostsPage — estimated spend across AI models, email, hosting, and storage.
 * Fetches /api/admin/watch/costs with local mock fallback. Layout unchanged.
 */
import { YoumiWatchHeader } from '../components/YoumiWatchHeader'
import { MetricCard } from '../components/MetricCard'
import { GlassCard } from '../components/GlassCard'
import { TrendChart } from '../components/TrendChart'
import { CostDistribution } from '../components/CostDistribution'
import { BudgetCard } from '../components/BudgetCard'
import { CostBreakdown } from '../components/CostBreakdown'
import { ForecastCard } from '../components/ForecastCard'
import { useWatchPageData } from '../hooks/useWatchPageData'
import type { CostsPayload } from '../types/api'
import {
  costMetrics,
  costTrend,
  costDistribution,
  budgetSummary,
  costBreakdown,
  costForecast,
} from '../data/mockData'

const FALLBACK: CostsPayload = {
  metrics: costMetrics,
  trend: costTrend,
  distribution: costDistribution,
  budget: budgetSummary,
  breakdown: costBreakdown,
  forecast: costForecast,
}

export function CostsPage() {
  const { data, source, coverage, loading, unauthorized, refresh } =
    useWatchPageData<CostsPayload>('costs', FALLBACK)

  return (
    <>
      <YoumiWatchHeader
        title="Costs"
        subtitle="Track estimated spending across AI models, email, hosting, and storage."
        onRefresh={refresh}
        source={source}
        coverage={coverage}
        dataLoading={loading}
        unauthorized={unauthorized}
      />

      <div className="yw-metrics">
        {data.metrics.map((metric) => (
          <MetricCard key={metric.id} metric={metric} />
        ))}
      </div>

      <GlassCard
        className="yw-spaced"
        title="Cost Trend"
        subtitle="Estimated daily spend by provider over the last 7 days"
      >
        <TrendChart data={data.trend} />
      </GlassCard>

      <div className="yw-grid-2">
        <CostDistribution slices={data.distribution} centerValue={data.budget.currentSpend} />
        <BudgetCard budget={data.budget} />
      </div>

      <div className="yw-grid-2">
        <CostBreakdown rows={data.breakdown} />
        <ForecastCard forecast={data.forecast} />
      </div>
    </>
  )
}
