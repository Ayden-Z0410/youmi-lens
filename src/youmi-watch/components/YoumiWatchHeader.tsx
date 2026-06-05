/**
 * YoumiWatchHeader — page header shared by every Youmi Watch page. Title +
 * subtitle + a data-source badge on the left; a time-range selector, refresh
 * control, avatar, and sign-out on the right. `onRefresh` re-fetches the
 * current page's data; the refresh icon spins briefly while loading.
 */
import { useContext } from 'react'
import { WatchIcon } from './WatchIcons'
import { DataSourceBadge } from './DataSourceBadge'
import { signOutWatch } from '../lib/watchAuth'
import { WatchGateContext } from '../watchGateContext'
import type { DataSource } from '../lib/watchPageState'

export interface YoumiWatchHeaderProps {
  title: string
  subtitle: string
  /** Re-fetch the current page's data; the button is shown regardless. */
  onRefresh?: () => void
  /** Initials shown in the account avatar. */
  avatar?: string
  /** Time-range label (static placeholder until ranges are wired). */
  range?: string
  /** Current data source for the badge; omit to hide the badge. */
  source?: DataSource
  /** Whether a data fetch is in flight (spins the refresh icon, updates badge). */
  dataLoading?: boolean
  /** Whether the last fetch was rejected as unauthorized (access error). */
  unauthorized?: boolean
}

export function YoumiWatchHeader({
  title,
  subtitle,
  onRefresh,
  avatar = 'YW',
  range = 'Last 30 days',
  source,
  dataLoading = false,
  unauthorized = false,
}: YoumiWatchHeaderProps) {
  const gate = useContext(WatchGateContext)
  const handleSignOut = () => {
    if (gate) gate.signOut()
    else void signOutWatch()
  }
  return (
    <header className="yw-header">
      <div>
        <h1 className="yw-header__title">{title}</h1>
        <p className="yw-header__subtitle">{subtitle}</p>
        {source && (
          <div className="yw-header__source">
            <DataSourceBadge source={source} loading={dataLoading} unauthorized={unauthorized} />
          </div>
        )}
      </div>

      <div className="yw-header__actions">
        <button type="button" className="yw-select" title="Time range (coming soon)">
          {range}
          <WatchIcon name="chevron-down" size={15} />
        </button>
        <button
          type="button"
          className={`yw-icon-btn${dataLoading ? ' is-spinning' : ''}`}
          onClick={onRefresh}
          aria-label="Refresh"
          title="Refresh"
        >
          <WatchIcon name="refresh" size={17} />
        </button>
        <span className="yw-avatar" aria-hidden>
          {avatar}
        </span>
        <button
          type="button"
          className="yw-icon-btn"
          onClick={handleSignOut}
          aria-label="Sign out"
          title="Sign out"
        >
          <WatchIcon name="logout" size={17} />
        </button>
      </div>
    </header>
  )
}
