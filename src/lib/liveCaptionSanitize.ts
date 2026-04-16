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

/** TOEFL-style narrator line ASR often re-prepends on every interim refinement. */
const LISTEN_LECTURE_BOILERPLATE_LEAD =
  /^\s*Listen to (?:a |an )?part of a lecture(?: in [^\n.]{1,220})?(?:\.)?\s*/i

/** True if text begins with the common listen-to-a-lecture instruction. */
export function containsListenLectureBoilerplate(text: string): boolean {
  return /^\s*Listen to (?:a |an )?part of a lecture/i.test(text.trim())
}

/** Remove every leading occurrence of the boilerplate (used after first occurrence in session). */
export function stripLeadingListenBoilerplateRepeated(text: string): string {
  let t = text
  while (LISTEN_LECTURE_BOILERPLATE_LEAD.test(t)) {
    t = t.replace(LISTEN_LECTURE_BOILERPLATE_LEAD, '').trimStart()
  }
  return t
}

/**
 * Strip first Chinese sentence when it mirrors TOEFL-style lecture instructions.
 * Caller enables only after the first such line was already shown.
 */
export function stripRepeatedZhLectureIntroMirror(text: string): string {
  const t = text.trim()
  if (!t) return text
  const head = t.slice(0, 120)
  if (!head.startsWith('\u542c')) return text
  const hasTopic =
    head.includes('\u8bb2\u5ea7') ||
    head.includes('\u8bfe\u7a0b') ||
    head.includes('\u8bfe\u5802') ||
    head.includes('\u6d77\u6d0b') ||
    head.includes('\u751f\u7269\u5b66')
  if (!hasTopic) return text
  const idx = t.indexOf('\u3002')
  if (idx < 10 || idx > 160) return text
  return t.slice(idx + 1).trimStart()
}
