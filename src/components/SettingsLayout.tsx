import type { ReactNode } from 'react'
import { useLanguagePreferences } from '../languagePreferencesContext'
import type { DesktopI18nKey } from '../lib/desktopI18n'
import { SETTINGS_SECTIONS, type SettingsSection } from '../lib/settingsSections'

const SECTION_LABEL_KEY: Record<SettingsSection, DesktopI18nKey> = {
  appearance: 'settings.appearance',
  capture: 'settings.capture',
  language: 'settings.language',
  liveCaptions: 'settings.liveCaptions',
  dataBackup: 'settings.dataBackup',
  autoUpdate: 'settings.autoUpdate',
  account: 'settings.account',
  planUsage: 'settings.planUsage',
  advancedAi: 'settings.advancedAi',
  support: 'settings.support',
}

/**
 * Settings master/detail frame, ported from the approved mockup
 * (youmi-lens-desktop-v2-mockup/settings.html → `.settings-grid`).
 *
 * The master column is a real navigation list; the previous implementation
 * rendered it as inert `<span>`s inside the Language page, which is why Settings
 * could only ever show Language.
 */
export function SettingsLayout({
  section,
  onSectionChange,
  children,
}: {
  section: SettingsSection
  onSectionChange: (next: SettingsSection) => void
  children: ReactNode
}) {
  const { t } = useLanguagePreferences()

  return (
    <div className="settings-v2">
      <aside className="settings-v2__list" aria-label={t('settings.title')}>
        <h1>{t('settings.title')}</h1>
        <nav>
          {SETTINGS_SECTIONS.map((key) => (
            <button
              key={key}
              type="button"
              data-section={key}
              aria-current={section === key ? 'page' : undefined}
              onClick={() => onSectionChange(key)}
            >
              {t(SECTION_LABEL_KEY[key])}
            </button>
          ))}
        </nav>
      </aside>
      <section className="settings-v2__detail">{children}</section>
    </div>
  )
}

/** One settings row: name, low-weight help text, and a compact control. */
export function SettingsRow({
  name,
  help,
  control,
}: {
  name: string
  help?: string
  control?: ReactNode
}) {
  return (
    <div className="settings-v2__row">
      <div className="settings-v2__row-copy">
        <div className="settings-v2__name">{name}</div>
        {help ? <div className="settings-v2__help">{help}</div> : null}
      </div>
      {control ? <div className="settings-v2__control">{control}</div> : null}
    </div>
  )
}

/**
 * Placeholder detail for sections whose controls have not been migrated yet.
 * States plainly that the feature still lives in the legacy UI rather than
 * implying it has been rebuilt.
 */
export function SettingsPlaceholder({ title, note }: { title: string; note: string }) {
  return (
    <>
      <h2>{title}</h2>
      <p className="settings-v2__lead">{note}</p>
    </>
  )
}
