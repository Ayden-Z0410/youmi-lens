import { describe, expect, it } from 'vitest'

import {
  SUPPORTED_CONTENT_LANGUAGES,
  deepgramLanguageFor,
  qwenLanguageFor,
  resolveContentLanguagePair,
  shouldTranslate,
} from './contentLanguages.mjs'

describe('content language contract', () => {
it('all approved content languages have exact provider mappings', () => {
  expect(SUPPORTED_CONTENT_LANGUAGES).toEqual(['en', 'zh-Hans', 'ja', 'fr', 'es', 'ko'])
  expect(Object.fromEntries(SUPPORTED_CONTENT_LANGUAGES.map((l) => [l, deepgramLanguageFor(l)]))).toEqual({
    en: 'en-US', 'zh-Hans': 'zh-Hans', ja: 'ja', fr: 'fr', es: 'es', ko: 'ko',
  })
  expect(Object.fromEntries(SUPPORTED_CONTENT_LANGUAGES.map((l) => [l, qwenLanguageFor(l).code]))).toEqual({
    en: 'en', 'zh-Hans': 'zh', ja: 'ja', fr: 'fr', es: 'es', ko: 'ko',
  })
})

it('invalid and missing pairs use legacy en to zh-Hans defaults', () => {
  expect(resolveContentLanguagePair({})).toEqual({ sourceLanguage: 'en', translationLanguage: 'zh-Hans' })
  expect(resolveContentLanguagePair({ sourceLanguage: 'xx', translationLanguage: 'yy' })).toEqual({
    sourceLanguage: 'en', translationLanguage: 'zh-Hans',
  })
})

it('source equals target bypasses translation', () => {
  for (const language of SUPPORTED_CONTENT_LANGUAGES) expect(shouldTranslate(language, language)).toBe(false)
  expect(shouldTranslate('ja', 'en')).toBe(true)
})
})
