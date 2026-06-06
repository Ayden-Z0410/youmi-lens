/**
 * DataSourceBadge — soft, non-alarming pill that tells the user whether the
 * current page is showing Live data, Partial live, Server mock, Local fallback,
 * or an Access error. Styled to fit the Liquid Glass design (see .yw-source in
 * CSS).
 */
import { dataSourceLabel, dataSourceTone, type DataSource } from '../lib/watchPageState'

export interface DataSourceBadgeProps {
  source: DataSource
  loading?: boolean
  unauthorized?: boolean
}

export function DataSourceBadge({ source, loading = false, unauthorized = false }: DataSourceBadgeProps) {
  const tone = dataSourceTone({ source, unauthorized })
  const label = dataSourceLabel({ source, unauthorized })
  return (
    <span className={`yw-source yw-source--${tone}`} aria-live="polite">
      <span className={`yw-source__dot${loading ? ' is-loading' : ''}`} />
      {loading ? 'Updating…' : label}
    </span>
  )
}
