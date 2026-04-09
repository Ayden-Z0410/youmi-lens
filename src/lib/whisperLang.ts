/** Optional Whisper `language` param (ISO 639-1); improves accuracy when set. */
export function whisperLanguageHint(bcp47: string): string | undefined {
  const low = bcp47.trim().toLowerCase()
  if (low.startsWith('en')) return 'en'
  if (low.startsWith('zh')) return 'zh'
  if (low.startsWith('ja')) return 'ja'
  if (low.startsWith('ko')) return 'ko'
  return undefined
}
