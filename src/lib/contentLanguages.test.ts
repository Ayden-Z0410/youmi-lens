import { describe, expect, it } from 'vitest'
import { CONTENT_LANGUAGES, LANGUAGE_CODES } from './contentLanguages'

describe('Desktop Phase 1A language registry', () => {
  it('uses only the approved six language codes and labels', () => {
    expect(CONTENT_LANGUAGES.map((language) => language.code)).toEqual(LANGUAGE_CODES)
    expect(CONTENT_LANGUAGES.map((language) => language.label)).toEqual([
      'English', '简体中文', '日本語', 'Français', 'Español', '한국어',
    ])
  })

  it('does not claim unverified live languages are available', () => {
    expect(CONTENT_LANGUAGES.find((language) => language.code === 'en')?.caption).toBe('available')
    expect(CONTENT_LANGUAGES.find((language) => language.code === 'zh-Hans')?.translation).toBe('available')
    for (const code of ['ja', 'fr', 'es', 'ko']) {
      const language = CONTENT_LANGUAGES.find((item) => item.code === code)
      expect(language?.caption).not.toBe('available')
      expect(language?.translation).not.toBe('available')
    }
  })
})
