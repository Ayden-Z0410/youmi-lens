/**
 * DataSourceBadge — soft, non-alarming indicator of whether the page is showing
 * Live data, Partial data, Server mock, Local fallback, or an Access error. For
 * partial data it appends a short coverage explanation (e.g. "Real data for 1
 * of 5 providers."). Styled to fit the Liquid Glass design (see .yw-source).
 */
import {
  coverageText,
  dataSourceLabel,
  dataSourceTone,
  type DataSource,
} from '../lib/watchPageState'
import type { WatchCoverage } from '../types/api'

export interface DataSourceBadgeProps {
  source: DataSource
  coverage?: WatchCoverage | null
  loading?: boolean
  unauthorized?: boolean
}

export function DataSourceBadge({
  source,
  coverage = null,
  loading = false,
  unauthorized = false,
}: DataSourceBadgeProps) {
  const tone = dataSourceTone({ source, unauthorized })
  const label = dataSourceLabel({ source, unauthorized })
  const detail = unauthorized ? '' : coverageText(source, coverage)
  return (
    <span className="yw-source-wrap">
      <span className={`yw-source yw-source--${tone}`} aria-live="polite">
        <span className={`yw-source__dot${loading ? ' is-loading' : ''}`} />
        {loading ? 'Updating…' : label}
      </span>
      {detail && <span className="yw-source__detail">{detail}</span>}
    </span>
  )
}
