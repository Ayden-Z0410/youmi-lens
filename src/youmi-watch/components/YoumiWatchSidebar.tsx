/**
 * YoumiWatchSidebar — deep-navy glass control-center rail. Holds the Youmi Watch
 * brand lockup, the primary nav (Overview / Providers), and a set of disabled
 * "coming soon" items that preview the eventual admin surface.
 */
import { YoumiLensMonogramY } from '../../branding/YoumiLensMonogramY'
import type { WatchRoute } from '../routes'
import { WatchIcon, type IconName } from './WatchIcons'

interface NavItem {
  route: WatchRoute
  label: string
  icon: IconName
}

interface FutureItem {
  label: string
  icon: IconName
  badge?: string
}

const PRIMARY_NAV: NavItem[] = [
  { route: 'overview', label: 'Overview', icon: 'overview' },
  { route: 'providers', label: 'Providers', icon: 'providers' },
  { route: 'alerts', label: 'Alerts', icon: 'alert' },
  { route: 'costs', label: 'Costs', icon: 'cost' },
]

const FUTURE_NAV: FutureItem[] = [
  { label: 'Users', icon: 'users', badge: '3' },
  { label: 'Logs', icon: 'logs' },
  { label: 'Settings', icon: 'settings' },
]

export interface YoumiWatchSidebarProps {
  active: WatchRoute
  onNavigate: (route: WatchRoute) => void
}

export function YoumiWatchSidebar({ active, onNavigate }: YoumiWatchSidebarProps) {
  return (
    <aside className="yw-sidebar">
      <div className="yw-brand">
        <span className="yw-brand__mark">
          <YoumiLensMonogramY size={20} color="#ffffff" />
        </span>
        <div>
          <div className="yw-brand__title">Youmi Watch</div>
          <div className="yw-brand__subtitle">Developer Monitor</div>
        </div>
      </div>

      <nav className="yw-nav" aria-label="Youmi Watch">
        {PRIMARY_NAV.map((item) => (
          <button
            key={item.route}
            type="button"
            className={`yw-nav__item${active === item.route ? ' is-active' : ''}`}
            aria-current={active === item.route ? 'page' : undefined}
            onClick={() => onNavigate(item.route)}
          >
            <span className="yw-nav__icon">
              <WatchIcon name={item.icon} size={18} />
            </span>
            <span className="yw-nav__label">{item.label}</span>
          </button>
        ))}

        <div className="yw-nav__section">Coming soon</div>
        {FUTURE_NAV.map((item) => (
          <button
            key={item.label}
            type="button"
            className="yw-nav__item"
            disabled
            title="Available in a future release"
          >
            <span className="yw-nav__icon">
              <WatchIcon name={item.icon} size={18} />
            </span>
            <span className="yw-nav__label">{item.label}</span>
            {item.badge && <span className="yw-nav__badge">{item.badge}</span>}
          </button>
        ))}
      </nav>

      <div className="yw-sidebar__footer">
        <div className="yw-sidebar__status">
          <span className="yw-sidebar__dot" />
          All systems operational
        </div>
      </div>
    </aside>
  )
}
