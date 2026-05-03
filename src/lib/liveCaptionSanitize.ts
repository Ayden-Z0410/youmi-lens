/** Strip CJK / Japanese / Korean from EN caption source (same rules as LiveEngine translate path). */
export function sanitizeEnglishForZhTranslate(text: string): string {
  return text
    .replace(/\p{Script=Han}/gu, ' ')
    .replace(/[\u3040-\u30ff]/gu, ' ')
    .replace(/[\uac00-\ud7af]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normCaptionSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Latin word (5+) + Han in one line ⇒ ASR/merge garbage (e.g. `Class个we`). */
export function isGarbledMixedScriptLine(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (!/\p{Script=Han}/u.test(t)) return false
  return /\b[A-Za-z]{5,}\b/.test(t)
}

/** English primary (ASR) line: no CJK scripts. */
export function isEnglishPrimarySlotText(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (/\p{Script=Han}/u.test(t)) return false
  if (/[\u3040-\u30ff]/u.test(t)) return false
  if (/[\uac00-\ud7af]/u.test(t)) return false
  return true
}

/**
 * Normalize EN primary payload: accept clean ASR, or one CJK-strip pass; otherwise reject (do not show).
 */
export function normalizeEnglishPrimaryPayloadOrReject(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (isEnglishPrimarySlotText(t) && !isGarbledMixedScriptLine(t)) return t
  const cleaned = sanitizeEnglishForZhTranslate(t).trim()
  if (cleaned && isEnglishPrimarySlotText(cleaned) && !isGarbledMixedScriptLine(cleaned)) return cleaned
  return null
}

/** Translation line when target is Chinese: must contain Han, or short non-Latin junk only. */
export function isZhTranslationSlotText(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (/\p{Script=Han}/u.test(t)) return true
  return t.length <= 16 && !/\b[A-Za-z]{5,}\b/.test(t)
}

/** Translation line when target is English: no Han runs in secondary EN. */
export function isEnTranslationSlotText(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (/\p{Script=Han}/u.test(t)) return false
  return true
}

/** Backend / client error tokens that must never appear as live translation text. */
const REJECTED_TRANSLATION_PAYLOAD_HINTS = new Set([
  'auth_required',
  'quota_required',
  'quota_suspended',
  'beta_limit_reached',
  'recording_too_long',
  'daily_recording_limit_reached',
  'session_limit_reached',
  'invalid_request',
  'youmi ai setup is not available yet.',
])

export function normalizeZhPayloadOrReject(raw: string, translateTarget: 'zh' | 'en' | 'off'): string | null {
  if (translateTarget === 'off') return raw.trim() || null
  const t = raw.trim()
  if (!t) return null
  const hintKey = t.toLowerCase()
  if (REJECTED_TRANSLATION_PAYLOAD_HINTS.has(hintKey)) return null
  if (isGarbledMixedScriptLine(t)) return null
  if (translateTarget === 'zh') {
    if (!isZhTranslationSlotText(t)) return null
    return t
  }
  if (!isEnTranslationSlotText(t)) return null
  return t
}
