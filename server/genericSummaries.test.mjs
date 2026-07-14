import { describe, it, expect } from 'vitest'
import { legacySummaryMirror, shouldTranslate } from './contentLanguages.mjs'
import { buildSummarizeMessages } from './ai/summarizePrompt.mjs'

const SRC = 'SOURCE_SUMMARY'
const TR = 'TRANSLATED_SUMMARY'

describe('legacySummaryMirror — language-based, never role-based', () => {
  it('en -> zh-Hans: summary_en=source, summary_zh=translated', () => {
    expect(legacySummaryMirror('en', 'zh-Hans', SRC, TR)).toEqual({ summary_en: SRC, summary_zh: TR })
  })
  it('zh-Hans -> en: summary_zh=source, summary_en=translated', () => {
    expect(legacySummaryMirror('zh-Hans', 'en', SRC, TR)).toEqual({ summary_en: TR, summary_zh: SRC })
  })
  it('ja -> en: summary_en=translated, summary_zh=null', () => {
    expect(legacySummaryMirror('ja', 'en', SRC, TR)).toEqual({ summary_en: TR, summary_zh: null })
  })
  it('fr -> es: both legacy columns null (never non-en/non-zh content)', () => {
    expect(legacySummaryMirror('fr', 'es', SRC, TR)).toEqual({ summary_en: null, summary_zh: null })
  })
  it('ko -> ko: one summary, both legacy columns null', () => {
    expect(legacySummaryMirror('ko', 'ko', SRC, null)).toEqual({ summary_en: null, summary_zh: null })
  })
  it('en -> en: summary_en=source (single summary), summary_zh=null', () => {
    expect(legacySummaryMirror('en', 'en', SRC, null)).toEqual({ summary_en: SRC, summary_zh: null })
  })
  it('zh-Hans -> zh-Hans: summary_zh=source, summary_en=null', () => {
    expect(legacySummaryMirror('zh-Hans', 'zh-Hans', SRC, null)).toEqual({ summary_en: null, summary_zh: SRC })
  })
  it('never places ja/fr/es/ko content into summary_en/summary_zh', () => {
    for (const [s, t] of [['ja', 'fr'], ['fr', 'ko'], ['es', 'ja'], ['ko', 'es']]) {
      const { summary_en, summary_zh } = legacySummaryMirror(s, t, SRC, TR)
      expect(summary_en).toBeNull()
      expect(summary_zh).toBeNull()
    }
  })
})

describe('buildSummarizeMessages — language routing + single/dual output', () => {
  it('source != target: requests both fields, names both languages', () => {
    const [system] = buildSummarizeMessages('t', 'c', 'ti', { sourceName: 'Japanese', targetName: 'English', needTranslated: true })
    expect(system.content).toMatch(/two string fields: source_summary and translated_summary/)
    expect(system.content).toMatch(/Japanese/)
    expect(system.content).toMatch(/English/)
  })
  it('source == target: requests exactly one field, no translated', () => {
    const [system] = buildSummarizeMessages('t', 'c', 'ti', { sourceName: 'Korean', targetName: 'Korean', needTranslated: false })
    expect(system.content).toMatch(/exactly one string field: source_summary/)
    expect(system.content).not.toMatch(/translated_summary/)
  })
  it('shouldTranslate drives needTranslated (source==target => one call, one summary)', () => {
    expect(shouldTranslate('ko', 'ko')).toBe(false)
    expect(shouldTranslate('ja', 'en')).toBe(true)
  })
})
