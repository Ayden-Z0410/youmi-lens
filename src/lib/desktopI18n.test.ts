import { describe, expect, it } from 'vitest'
import { LANGUAGE_CODES } from './contentLanguages'
import { DESKTOP_I18N_KEYS, desktopDictionaryKeys, translateDesktop } from './desktopI18n'

describe('Phase 1A Desktop i18n boundary', () => {
  it('keeps identical key sets for all six locale dictionaries', () => {
    const expected = [...DESKTOP_I18N_KEYS].sort()
    for (const locale of LANGUAGE_CODES) expect(desktopDictionaryKeys(locale)).toEqual(expected)
  })

  it('uses English source strings and a raw-key terminal fallback contract', () => {
    expect(translateDesktop('en', 'record.start')).toBe('Start Recording')
    expect(translateDesktop('zh-Hans', 'record.start')).toBe('开始录音')
  })
})
