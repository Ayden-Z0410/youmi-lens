/**
 * YoumiWatchLayout — the macOS-style embedded "app window" that frames every
 * Youmi Watch page. Icy-blue backdrop → frosted window → navy sidebar + a
 * scrollable main column. Pages render their own header (via YoumiWatchHeader)
 * plus body content as children.
 */
import type { ReactNode } from 'react'
import type { WatchRoute } from '../routes'
import { YoumiWatchSidebar } from './YoumiWatchSidebar'

export interface YoumiWatchLayoutProps {
  active: WatchRoute
  onNavigate: (route: WatchRoute) => void
  children: ReactNode
}

export function YoumiWatchLayout({ active, onNavigate, children }: YoumiWatchLayoutProps) {
  return (
    <div className="yw-root">
      <div className="yw-window">
        <YoumiWatchSidebar active={active} onNavigate={onNavigate} />
        <main className="yw-main">
          <div className="yw-main__scroll">{children}</div>
        </main>
      </div>
    </div>
  )
}
