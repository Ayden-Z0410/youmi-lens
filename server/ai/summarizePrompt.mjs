/** Shared multilingual lecture summary prompt (provider-agnostic). */

/**
 * Build the summarize chat messages.
 *
 * @param {string} transcript  Finalized source-language transcript.
 * @param {string} course
 * @param {string} title
 * @param {object} langs
 * @param {string} langs.sourceName      Human language name for the source summary (e.g. "Japanese").
 * @param {string} langs.targetName      Human language name for the translated summary (e.g. "English").
 * @param {boolean} langs.needTranslated When false (source === target), request ONE summary only.
 *
 * Returns JSON with `source_summary` always, and `translated_summary` only when
 * needTranslated. Each summary is written entirely in its own language — headings
 * and body — with the same three-section structure, and languages are never mixed.
 */
export function buildSummarizeMessages(
  transcript,
  course,
  title,
  { sourceName = 'English', targetName = 'Simplified Chinese', needTranslated = true } = {},
) {
  const sectionSpec = (langName) =>
    [
      `written ENTIRELY in ${langName} — BOTH the three markdown section headings and all body text must be in ${langName}, with no other language mixed in.`,
      'The three sections (as "## " markdown headings) are, in order: an Outline, Key terms, and Takeaways.',
    ].join(' ')

  const lines = [
    'You help international students review university lectures.',
    'Return ONLY valid JSON. No markdown code fences around the JSON.',
    'Do not invent facts; use only the transcript. Do not mix languages within a single field.',
    '',
    needTranslated
      ? 'The JSON has exactly two string fields: source_summary and translated_summary.'
      : 'The JSON has exactly one string field: source_summary.',
    '',
    `source_summary: a markdown summary ${sectionSpec(sourceName)}`,
  ]
  if (needTranslated) {
    lines.push(
      '',
      `translated_summary: the SAME summary ${sectionSpec(targetName)} It must convey the same meaning as source_summary — a faithful translation, adding no new facts.`,
    )
  }

  const system = lines.join('\n')
  const user = `Course: ${course || 'Unknown'}
Lecture title: ${title || 'Untitled'}

Transcript:
${transcript}`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}
