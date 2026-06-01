/**
 * YoumiWatchHeader — page header shared by every Youmi Watch page. Title +
 * subtitle on the left, a time-range selector, refresh control, and the
 * signed-in avatar on the right. The controls are presentational for now
 * (mock data) — `onRefresh` is wired but the range select is static.
 */
import { WatchIcon } from './WatchIcons'

export interface YoumiWatchHeaderProps {
  title: string
  subtitle: string
  /** Optional refresh handler; the button is shown regardless. */
  onRefresh?: () => void
  /** Initials shown in the account avatar. */
  avatar?: string
  /** Time-range label (static placeholder until ranges are wired). */
  range?: string
}

export function YoumiWatchHeader({
  title,
  subtitle,
  onRefresh,
  avatar = 'YW',
  range = 'Last 30 days',
}: YoumiWatchHeaderProps) {
  return (
    <header className="yw-header">
      <div>
        <h1 className="yw-header__title">{title}</h1>
        <p className="yw-header__subtitle">{subtitle}</p>
      </div>

      <div className="yw-header__actions">
        <button type="button" className="yw-select" title="Time range (coming soon)">
          {range}
          <WatchIcon name="chevron-down" size={15} />
        </button>
        <button
          type="button"
          className="yw-icon-btn"
          onClick={onRefresh}
          aria-label="Refresh"
          title="Refresh"
        >
          <WatchIcon name="refresh" size={17} />
        </button>
        <span className="yw-avatar" aria-hidden>
          {avatar}
        </span>
      </div>
    </header>
  )
}
