import type { SVGProps } from 'react'
import { useLanguagePreferences } from '../languagePreferencesContext'

export type DesktopPrimaryView = 'record' | 'courses' | 'settings'

/** Icon paths copied from the approved mockup so the glyphs match exactly. */
function SidebarIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: DesktopPrimaryView }) {
  if (name === 'record') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...props}>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 12a7 7 0 0 0 14 0M12 19v3" />
      </svg>
    )
  }
  if (name === 'courses') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" {...props}>
        <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10v16H5.5A1.5 1.5 0 0 1 4 18.5zM12 4h4.5A1.5 1.5 0 0 1 18 5.5v13a1.5 1.5 0 0 1-1.5 1.5H12z" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A8 8 0 0 0 15 6.2L14.7 3h-4L10 6.2a8 8 0 0 0-1.5.9l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.5.9l.7 3.2h4l.3-3.2a8 8 0 0 0 1.5-.9l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1z" />
    </svg>
  )
}

/**
 * The V2 primary sidebar.
 *
 * Emits its OWN `<aside>` — it is the sidebar, not a fragment placed inside
 * someone else's. That is what stops it being nested in the legacy `.yl-sidebar`.
 *
 * The DOM is identical on every page. Only `aria-current` moves. Nothing about
 * the brand, the width, the order, the spacing or the footer is view-dependent,
 * so navigating cannot make the chrome shift.
 *
 * Deliberately NOT here (absent from the approved mockup): usage meter, updater
 * entry, version string, or any extra status region.
 */
export function DesktopSidebar({
  activeView,
  onNavigate,
  accountName,
  accountPlan,
  onAccountClick,
}: {
  activeView: DesktopPrimaryView
  onNavigate: (view: DesktopPrimaryView) => void
  accountName: string
  accountPlan: string
  onAccountClick?: () => void
}) {
  const { t } = useLanguagePreferences()
  const items: Array<{ view: DesktopPrimaryView; label: string }> = [
    { view: 'record', label: t('nav.record') },
    { view: 'courses', label: t('nav.courses') },
    { view: 'settings', label: t('nav.settings') },
  ]
  const initials = accountName.trim().slice(0, 2).toUpperCase() || 'YL'

  return (
    <aside className="desktop-v2-sidebar" data-sidebar-structure="desktop-v2">
      {/* Official wordmark asset at wide widths; the CSS swaps in the official
          app icon on the 72px rail. Neither is redrawn. */}
      <div className="desktop-v2-brand">
        <img src="/brand/youmi-lens-wordmark-transparent.png" alt="Youmi Lens" />
      </div>

      <nav className="desktop-v2-nav" aria-label="Primary">
        {items.map(({ view, label }) => (
          <button
            key={view}
            type="button"
            data-view={view}
            aria-current={activeView === view ? 'page' : undefined}
            onClick={() => onNavigate(view)}
            title={label}
          >
            <SidebarIcon name={view} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="desktop-v2-sidebar__spacer" />

      <div className="desktop-v2-sidebar__foot">
        <button
          type="button"
          className="desktop-v2-account"
          onClick={onAccountClick}
          disabled={!onAccountClick}
          title={`${accountName} · ${accountPlan}`}
        >
          <span className="desktop-v2-avatar" aria-hidden="true">{initials}</span>
          <span className="desktop-v2-account__copy">
            <span className="desktop-v2-account__name">{accountName}</span>
            <span className="desktop-v2-account__plan">{accountPlan}</span>
          </span>
        </button>
      </div>
    </aside>
  )
}
