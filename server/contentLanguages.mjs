export const SUPPORTED_CONTENT_LANGUAGES = Object.freeze(['en', 'zh-Hans', 'ja', 'fr', 'es', 'ko'])
export const DEFAULT_SOURCE_LANGUAGE = 'en'
export const DEFAULT_TRANSLATION_LANGUAGE = 'zh-Hans'

const DESCRIPTORS = Object.freeze({
  en: { deepgram: 'en-US', qwenCode: 'en', qwenName: 'English' },
  'zh-Hans': { deepgram: 'zh-Hans', qwenCode: 'zh', qwenName: 'Simplified Chinese' },
  ja: { deepgram: 'ja', qwenCode: 'ja', qwenName: 'Japanese' },
  fr: { deepgram: 'fr', qwenCode: 'fr', qwenName: 'French' },
  es: { deepgram: 'es', qwenCode: 'es', qwenName: 'Spanish' },
  ko: { deepgram: 'ko', qwenCode: 'ko', qwenName: 'Korean' },
})

export function isContentLanguage(value) { return typeof value === 'string' && SUPPORTED_CONTENT_LANGUAGES.includes(value) }
export function resolveContentLanguagePair(input = {}) {
  return {
    sourceLanguage: isContentLanguage(input.sourceLanguage) ? input.sourceLanguage : DEFAULT_SOURCE_LANGUAGE,
    translationLanguage: isContentLanguage(input.translationLanguage) ? input.translationLanguage : DEFAULT_TRANSLATION_LANGUAGE,
  }
}
export function deepgramLanguageFor(language) {
  if (!isContentLanguage(language)) throw new Error('UNSUPPORTED_SOURCE_LANGUAGE')
  return DESCRIPTORS[language].deepgram
}
export function qwenLanguageFor(language) {
  if (!isContentLanguage(language)) throw new Error('UNSUPPORTED_TRANSLATION_LANGUAGE')
  return { code: DESCRIPTORS[language].qwenCode, name: DESCRIPTORS[language].qwenName }
}
export function shouldTranslate(sourceLanguage, translationLanguage) { return sourceLanguage !== translationLanguage }

/**
 * Derive the legacy language-specific summary columns (summary_en / summary_zh)
 * from the generic source/translated summaries. Each legacy column holds the
 * summary written in THAT language — whether it is the source or the translated
 * version — and a non-English/non-Chinese summary is never placed in either.
 * Generic source_summary / translated_summary remain authoritative.
 */
export function legacySummaryMirror(sourceLanguage, translationLanguage, sourceSummary, translatedSummary) {
  const summary_en =
    sourceLanguage === 'en' ? (sourceSummary ?? null)
      : translationLanguage === 'en' ? (translatedSummary ?? null)
        : null
  const summary_zh =
    sourceLanguage === 'zh-Hans' ? (sourceSummary ?? null)
      : translationLanguage === 'zh-Hans' ? (translatedSummary ?? null)
        : null
  return { summary_en, summary_zh }
}
