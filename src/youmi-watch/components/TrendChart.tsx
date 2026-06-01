/**
 * TrendChart — dependency-free SVG line chart with a soft outer glow ("glow
 * chart" from the design brief). Renders one smoothed line per series over a
 * shared x-axis, with light horizontal gridlines and a legend. Uses a fixed
 * viewBox and scales responsively to its container width.
 */
import { useId } from 'react'
import type { TrendChartData } from '../data/mockData'

const W = 720
const H = 260
const PAD = { top: 16, right: 18, bottom: 30, left: 44 }
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom
const Y_TICKS = 4

/** Catmull-Rom → cubic-bezier smoothing for an array of [x,y] points. */
function smoothPath(pts: Array<[number, number]>): string {
  if (pts.length < 2) return ''
  const d: string[] = [`M ${pts[0]![0]} ${pts[0]![1]}`]
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!
    const p1 = pts[i]!
    const p2 = pts[i + 1]!
    const p3 = pts[i + 2] ?? p2
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6
    d.push(`C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2[0]} ${p2[1]}`)
  }
  return d.join(' ')
}

function formatTick(value: number): string {
  if (value >= 1000) {
    const k = value / 1000
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`
  }
  return String(value)
}

export function TrendChart({ data }: { data: TrendChartData }) {
  const glowId = useId().replace(/:/g, '')
  const { labels, series } = data
  const yMax =
    data.yMax ?? Math.max(1, ...series.flatMap((s) => s.points)) * 1.05

  const xAt = (i: number, n: number) =>
    PAD.left + (n <= 1 ? 0 : (PLOT_W * i) / (n - 1))
  const yAt = (v: number) => PAD.top + PLOT_H - (v / yMax) * PLOT_H

  return (
    <div className="yw-chart">
      <svg className="yw-chart__svg" viewBox={`0 0 ${W} ${H}`} role="img">
        <defs>
          <filter id={`glow-${glowId}`} x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* horizontal gridlines + y labels */}
        {Array.from({ length: Y_TICKS + 1 }, (_, i) => {
          const value = (yMax / Y_TICKS) * (Y_TICKS - i)
          const y = PAD.top + (PLOT_H / Y_TICKS) * i
          return (
            <g key={i}>
              <line className="yw-chart__grid" x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} />
              <text className="yw-chart__axis" x={PAD.left - 10} y={y + 4} textAnchor="end">
                {formatTick(value)}
              </text>
            </g>
          )
        })}

        {/* x labels */}
        {labels.map((label, i) => (
          <text
            key={label}
            className="yw-chart__axis"
            x={xAt(i, labels.length)}
            y={H - 8}
            textAnchor="middle"
          >
            {label}
          </text>
        ))}

        {/* series — blurred glow underlay + crisp line */}
        {series.map((s) => {
          const pts = s.points.map(
            (v, i) => [xAt(i, s.points.length), yAt(v)] as [number, number],
          )
          const path = smoothPath(pts)
          return (
            <g key={s.name}>
              <path
                d={path}
                fill="none"
                stroke={s.color}
                strokeWidth={3}
                strokeLinecap="round"
                opacity={0.9}
                filter={`url(#glow-${glowId})`}
              />
              {pts.map(([cx, cy], i) => (
                <circle key={i} cx={cx} cy={cy} r={2.4} fill={s.color} opacity={0.85} />
              ))}
            </g>
          )
        })}
      </svg>

      <div className="yw-chart__legend">
        {series.map((s) => (
          <span key={s.name} className="yw-chart__legend-item">
            <span className="yw-chart__swatch" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  )
}
