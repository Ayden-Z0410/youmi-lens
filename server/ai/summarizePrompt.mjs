/** Shared bilingual lecture summary prompt (provider-agnostic). */

export function buildSummarizeMessages(transcript, course, title) {
  const system = [
    'You help international students review US university lectures.',
    'Return ONLY valid JSON with exactly two string fields: summary_en and summary_zh.',
    'No markdown code fences.',
    '',
    'summary_en: markdown for English readers with headings:',
    '## Outline',
    '## Key terms',
    '## Takeaways',
    'Use English only in summary_en.',
    '',
    'summary_zh: markdown for Chinese readers with headings:',
    '## \u5927\u7eb2',
    '## \u5173\u952e\u672f\u8bed',
    '## \u8981\u70b9',
    'Use Chinese for body text in summary_zh.',
    '',
    'Do not invent facts; only use the transcript.',
  ].join('\n')

  const user = `Course: ${course || 'Unknown'}
Lecture title: ${title || 'Untitled'}

Transcript:
${transcript}`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}
