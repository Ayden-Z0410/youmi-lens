/**
 * CostDistribution — donut chart of estimated spend share per provider, with a
 * legend listing each provider's percentage. Dependency-free SVG (stroke-arc
 * segments) using the same soft accent palette as the rest of Youmi Watch.
 */
import type { CostDistributionSlice } from '../data/mockData'
import { GlassCard } from './GlassCard'

const SIZE = 132
const RADIUS = 52
const STROKE = 18
const CIRC = 2 * Math.PI * RADIUS

export function CostDistribution({
  slices,
  centerValue,
  centerLabel = 'this month',
}: {
  slices: CostDistributionSlice[]
  centerValue: string
  centerLabel?: string
}) {
  // Precompute each arc's length and its cumulative start offset without
  // mutating a shared variable during render (keeps the renderer pure).
  const segments = slices.map((slice, i) => {
    const len = (slice.percent / 100) * CIRC
    const start = slices
      .slice(0, i)
      .reduce((sum, s) => sum + (s.percent / 100) * CIRC, 0)
    return { slice, len, start }
  })

  return (
    <GlassCard title="Provider Cost Distribution" subtitle="Share of estimated spend">
      <div className="yw-donut">
        <svg
          className="yw-donut__svg"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          role="img"
          aria-label="Provider cost distribution"
        >
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            {/* track */}
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke="rgba(10,25,47,0.06)"
              strokeWidth={STROKE}
            />
            {segments.map(({ slice, len, start }) => (
              <circle
                key={slice.id}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={slice.color}
                strokeWidth={STROKE}
                strokeDasharray={`${len} ${CIRC - len}`}
                strokeDashoffset={-start}
              />
            ))}
          </g>
          <text className="yw-donut__value" x="50%" y="48%" textAnchor="middle">
            {centerValue}
          </text>
          <text className="yw-donut__label" x="50%" y="62%" textAnchor="middle">
            {centerLabel}
          </text>
        </svg>

        <ul className="yw-donut__legend">
          {slices.map((slice) => (
            <li key={slice.id} className="yw-donut__legend-item">
              <span className="yw-donut__swatch" style={{ background: slice.color }} />
              <span className="yw-donut__legend-label">{slice.label}</span>
              <span className="yw-donut__legend-pct">{slice.percent}%</span>
            </li>
          ))}
        </ul>
      </div>
    </GlassCard>
  )
}
