export const LANGUAGE_CODES = ['en', 'zh-Hans', 'ja', 'fr', 'es', 'ko'] as const

export type ContentLanguageCode = (typeof LANGUAGE_CODES)[number]
export type LanguageAvailability = 'available' | 'beta' | 'not-enabled'

export type ContentLanguage = {
  code: ContentLanguageCode
  label: string
  caption: LanguageAvailability
  translation: LanguageAvailability
}

/**
 * Preference registry only. Availability describes the currently verified
 * Desktop live path; it is deliberately not a provider-routing declaration.
 */
export const CONTENT_LANGUAGES: readonly ContentLanguage[] = [
  { code: 'en', label: 'English', caption: 'available', translation: 'beta' },
  { code: 'zh-Hans', label: '简体中文', caption: 'beta', translation: 'available' },
  { code: 'ja', label: '日本語', caption: 'not-enabled', translation: 'not-enabled' },
  { code: 'fr', label: 'Français', caption: 'not-enabled', translation: 'not-enabled' },
  { code: 'es', label: 'Español', caption: 'not-enabled', translation: 'not-enabled' },
  { code: 'ko', label: '한국어', caption: 'not-enabled', translation: 'not-enabled' },
] as const

export function isContentLanguageCode(value: unknown): value is ContentLanguageCode {
  return typeof value === 'string' && LANGUAGE_CODES.includes(value as ContentLanguageCode)
}

export function getContentLanguage(code: ContentLanguageCode): ContentLanguage {
  return CONTENT_LANGUAGES.find((language) => language.code === code) ?? CONTENT_LANGUAGES[0]
}

export function contentLanguageLabel(code: ContentLanguageCode): string {
  return getContentLanguage(code).label
}
