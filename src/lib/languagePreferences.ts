import { isContentLanguageCode, type ContentLanguageCode } from './contentLanguages'

export const LANGUAGE_PREFERENCE_KEYS = {
  appLocale: 'youmi.appLanguage',
  captionLanguage: 'youmi.captionLanguage',
  translationLanguage: 'youmi.translationLanguage',
  languageMode: 'youmi.languageMode',
} as const

export const LEGACY_LANGUAGE_KEYS = {
  captionLanguage: 'lc_live_lang',
  translationLanguage: 'lc_translate_target',
} as const

export type LanguageMode = 'captions-only' | 'bilingual'

export type LanguagePreferences = {
  appLocale: ContentLanguageCode
  captionLanguage: ContentLanguageCode
  translationLanguage: ContentLanguageCode
  languageMode: LanguageMode
}

export type LanguagePreferenceName = keyof LanguagePreferences

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export const DEFAULT_LANGUAGE_PREFERENCES: LanguagePreferences = {
  appLocale: 'en',
  captionLanguage: 'en',
  translationLanguage: 'zh-Hans',
  languageMode: 'bilingual',
}

function readLanguage(value: string | null, fallback: ContentLanguageCode): ContentLanguageCode {
  return isContentLanguageCode(value) ? value : fallback
}

function readMode(value: string | null, fallback: LanguageMode): LanguageMode {
  return value === 'captions-only' || value === 'bilingual' ? value : fallback
}

function migrateLegacyCaption(value: string | null): ContentLanguageCode | null {
  if (value === 'en-US' || value === 'en') return 'en'
  if (value === 'zh' || value === 'zh-CN' || value === 'zh-Hans') return 'zh-Hans'
  return null
}

function migrateLegacyTranslation(value: string | null): ContentLanguageCode | null {
  if (value === 'zh' || value === 'zh-Hans') return 'zh-Hans'
  if (value === 'en') return 'en'
  return null
}

export function readLanguagePreferences(storage: StorageLike): LanguagePreferences {
  const legacyCaption = storage.getItem(LEGACY_LANGUAGE_KEYS.captionLanguage)
  const legacyTranslation = storage.getItem(LEGACY_LANGUAGE_KEYS.translationLanguage)
  const migratedCaption = migrateLegacyCaption(legacyCaption)
  const migratedTranslation = migrateLegacyTranslation(legacyTranslation)
  const migratedMode: LanguageMode = legacyTranslation === 'off' ? 'captions-only' : 'bilingual'

  return {
    appLocale: readLanguage(
      storage.getItem(LANGUAGE_PREFERENCE_KEYS.appLocale),
      DEFAULT_LANGUAGE_PREFERENCES.appLocale,
    ),
    captionLanguage: readLanguage(
      storage.getItem(LANGUAGE_PREFERENCE_KEYS.captionLanguage),
      migratedCaption ?? DEFAULT_LANGUAGE_PREFERENCES.captionLanguage,
    ),
    translationLanguage: readLanguage(
      storage.getItem(LANGUAGE_PREFERENCE_KEYS.translationLanguage),
      migratedTranslation ?? DEFAULT_LANGUAGE_PREFERENCES.translationLanguage,
    ),
    languageMode: readMode(
      storage.getItem(LANGUAGE_PREFERENCE_KEYS.languageMode),
      migratedMode,
    ),
  }
}

export function persistLanguagePreferences(
  storage: StorageLike,
  preferences: LanguagePreferences,
): void {
  for (const name of Object.keys(LANGUAGE_PREFERENCE_KEYS) as LanguagePreferenceName[]) {
    storage.setItem(LANGUAGE_PREFERENCE_KEYS[name], preferences[name])
  }
}

export function writeLanguagePreference<K extends LanguagePreferenceName>(
  storage: StorageLike,
  current: LanguagePreferences,
  name: K,
  value: LanguagePreferences[K],
): LanguagePreferences {
  storage.setItem(LANGUAGE_PREFERENCE_KEYS[name], value)
  return { ...current, [name]: value }
}
