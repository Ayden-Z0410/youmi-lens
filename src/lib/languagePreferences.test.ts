import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LANGUAGE_PREFERENCES,
  LANGUAGE_PREFERENCE_KEYS,
  LEGACY_LANGUAGE_KEYS,
  readLanguagePreferences,
  writeLanguagePreference,
  type StorageLike,
} from './languagePreferences'

class MemoryStorage implements StorageLike {
  values = new Map<string, string>()

  constructor(initial: Record<string, string> = {}) {
    Object.entries(initial).forEach(([key, value]) => this.values.set(key, value))
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('language preference migration', () => {
  it('migrates the documented legacy values without deleting old keys', () => {
    const storage = new MemoryStorage({
      [LEGACY_LANGUAGE_KEYS.captionLanguage]: 'en-US',
      [LEGACY_LANGUAGE_KEYS.translationLanguage]: 'zh',
    })
    expect(readLanguagePreferences(storage)).toEqual(DEFAULT_LANGUAGE_PREFERENCES)
    expect(storage.getItem(LEGACY_LANGUAGE_KEYS.captionLanguage)).toBe('en-US')
    expect(storage.getItem(LEGACY_LANGUAGE_KEYS.translationLanguage)).toBe('zh')
  })

  it('maps legacy English translation and off mode exactly', () => {
    const english = new MemoryStorage({ [LEGACY_LANGUAGE_KEYS.translationLanguage]: 'en' })
    expect(readLanguagePreferences(english).translationLanguage).toBe('en')

    const off = new MemoryStorage({ [LEGACY_LANGUAGE_KEYS.translationLanguage]: 'off' })
    expect(readLanguagePreferences(off).languageMode).toBe('captions-only')
    expect(readLanguagePreferences(off).translationLanguage).toBe('zh-Hans')
  })

  it('prefers valid new keys and falls back invalid values independently', () => {
    const storage = new MemoryStorage({
      [LANGUAGE_PREFERENCE_KEYS.appLocale]: 'invalid',
      [LANGUAGE_PREFERENCE_KEYS.captionLanguage]: 'ja',
      [LANGUAGE_PREFERENCE_KEYS.translationLanguage]: 'invalid',
      [LANGUAGE_PREFERENCE_KEYS.languageMode]: 'invalid',
    })
    expect(readLanguagePreferences(storage)).toEqual({
      appLocale: 'en',
      captionLanguage: 'ja',
      translationLanguage: 'zh-Hans',
      languageMode: 'bilingual',
    })
  })
})

describe('independent preference writes', () => {
  it('changing app language does not change caption, translation, or mode', () => {
    const storage = new MemoryStorage()
    const next = writeLanguagePreference(
      storage,
      DEFAULT_LANGUAGE_PREFERENCES,
      'appLocale',
      'fr',
    )
    expect(next).toEqual({ ...DEFAULT_LANGUAGE_PREFERENCES, appLocale: 'fr' })
    expect(storage.values).toEqual(new Map([[LANGUAGE_PREFERENCE_KEYS.appLocale, 'fr']]))
  })

  it('writes each of the four fields to its own key', () => {
    const storage = new MemoryStorage()
    let current = DEFAULT_LANGUAGE_PREFERENCES
    current = writeLanguagePreference(storage, current, 'captionLanguage', 'en')
    current = writeLanguagePreference(storage, current, 'translationLanguage', 'zh-Hans')
    current = writeLanguagePreference(storage, current, 'languageMode', 'captions-only')
    expect(current.languageMode).toBe('captions-only')
    expect([...storage.values.keys()].sort()).toEqual([
      LANGUAGE_PREFERENCE_KEYS.captionLanguage,
      LANGUAGE_PREFERENCE_KEYS.languageMode,
      LANGUAGE_PREFERENCE_KEYS.translationLanguage,
    ].sort())
  })
})
