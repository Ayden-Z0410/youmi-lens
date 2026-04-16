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
