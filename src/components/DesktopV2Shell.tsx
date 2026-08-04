import type { ReactNode } from 'react'
import { DesktopSidebar, type DesktopPrimaryView } from './DesktopSidebar'
import '../styles/desktop-v2.css'

/**
 * The Desktop V2 window chrome.
 *
 * This component owns the ENTIRE frame for a V2 view: the sidebar, the main
 * column, the toolbar and the scrolling page area. Nothing from the legacy
 * `YoumiLensShell` participates.
 *
 * Why a separate shell rather than reusing YoumiLensShell:
 * Phase 1A's first attempt nested the new sidebar inside the legacy shell and hid
 * the old chrome with `display:none !important`. The old `.yl-shell`,
 * `.yl-topbar`, `.yl-sidebar` and `.record-workspace` nodes stayed in the DOM and
 * kept controlling page geometry, which is why measurements never matched the
 * mockup. Here the old nodes are not hidden — they are never created.
 *
 * App.tsx renders EITHER this shell or the legacy one, never both.
 */
export function DesktopV2Shell({
  activeView,
  onNavigate,
  toolbarTitle,
  toolbarActions,
  accountName,
  accountPlan,
  onAccountClick,
  children,
}: {
  activeView: DesktopPrimaryView
  onNavigate: (view: DesktopPrimaryView) => void
  /** Real page title. The toolbar is never rendered as an empty bar. */
  toolbarTitle: string
  toolbarActions?: ReactNode
  accountName: string
  accountPlan: string
  onAccountClick?: () => void
  children: ReactNode
}) {
  return (
    <div className="desktop-v2" data-desktop-v2-shell="true">
      <DesktopSidebar
        activeView={activeView}
        onNavigate={onNavigate}
        accountName={accountName}
        accountPlan={accountPlan}
        onAccountClick={onAccountClick}
      />
      <main className="desktop-v2-main">
        <header className="desktop-v2-toolbar">
          <span className="desktop-v2-toolbar__title">{toolbarTitle}</span>
          <span className="desktop-v2-toolbar__spacer" />
          {toolbarActions}
        </header>
        <div className="desktop-v2-page">{children}</div>
      </main>
    </div>
  )
}
