import { createContext, useContext } from 'react'
import type { DesktopI18nKey } from './lib/desktopI18n'
import type {
  LanguagePreferenceName,
  LanguagePreferences,
} from './lib/languagePreferences'

export type LanguagePreferencesContextValue = {
  preferences: LanguagePreferences
  setPreference: <K extends LanguagePreferenceName>(
    name: K,
    value: LanguagePreferences[K],
  ) => void
  t: (key: DesktopI18nKey) => string
}

export const LanguagePreferencesContext = createContext<LanguagePreferencesContextValue | null>(null)

export function useLanguagePreferences(): LanguagePreferencesContextValue {
  const value = useContext(LanguagePreferencesContext)
  if (!value) throw new Error('useLanguagePreferences must be used inside LanguagePreferencesProvider')
  return value
}
