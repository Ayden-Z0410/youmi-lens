/**
 * LogFilters — frosted-glass filter bar for the Logs page: a search field plus
 * provider / status / severity / date-range dropdowns. Presentational mock
 * controls for now (no filtering wired) — kept deliberately simple.
 */
import type { LogFilterOption } from '../data/mockData'
import { GlassCard } from './GlassCard'
import { WatchIcon } from './WatchIcons'

export function LogFilters({ filters }: { filters: LogFilterOption[] }) {
  return (
    <GlassCard className="yw-spaced" title="Log Filters" subtitle="Narrow events by provider, status, and time">
      <div className="yw-filters">
        <div className="yw-search">
          <WatchIcon name="search" size={16} />
          <input
            type="text"
            className="yw-search__input"
            placeholder="Search events, request IDs, providers..."
            aria-label="Search logs"
          />
        </div>
        <div className="yw-filters__selects">
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className="yw-select"
              title={`${filter.label} filter (coming soon)`}
            >
              {filter.value}
              <WatchIcon name="chevron-down" size={15} />
            </button>
          ))}
        </div>
      </div>
    </GlassCard>
  )
}
