const OPENAI_AUDIO = 'https://api.openai.com/v1/audio/transcriptions'
const OPENAI_CHAT = 'https://api.openai.com/v1/chat/completions'

export async function transcribeWithWhisper(
  blob: Blob,
  apiKey: string,
  filename = 'lecture.webm',
  opts?: { language?: string },
): Promise<string> {
  const form = new FormData()
  form.append('file', blob, filename)
  form.append('model', 'whisper-1')
  if (opts?.language && /^[a-z]{2}$/i.test(opts.language)) {
    form.append('language', opts.language.toLowerCase())
  }

  const res = await fetch(OPENAI_AUDIO, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(err || `Transcription failed (${res.status})`)
  }

  const data = (await res.json()) as { text?: string }
  if (!data.text) throw new Error('No transcript in API response')
  return data.text
}

export async function summarizeLectureBilingual(
  transcript: string,
  apiKey: string,
  opts: { course: string; title: string },
): Promise<{ summaryEn: string; summaryZh: string }> {
  const system = [
    'You help international students review US university lectures.',
    'Return ONLY valid JSON with exactly two string fields: summary_en and summary_zh.',
    'No markdown code fences. Escape newlines as \\n inside JSON strings if needed.',
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

  const user = `Course: ${opts.course || 'Unknown'}
Lecture title: ${opts.title || 'Untitled'}

Transcript:
${transcript}`

  const res = await fetch(OPENAI_CHAT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(err || `Summary failed (${res.status})`)
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const raw = data.choices?.[0]?.message?.content
  if (!raw) throw new Error('No summary in API response')

  let parsed: { summary_en?: string; summary_zh?: string }
  try {
    parsed = JSON.parse(raw) as { summary_en?: string; summary_zh?: string }
  } catch {
    throw new Error('Summary JSON could not be parsed')
  }

  const summaryEn = parsed.summary_en?.trim()
  const summaryZh = parsed.summary_zh?.trim()
  if (!summaryEn || !summaryZh) {
    throw new Error('API returned JSON without summary_en and summary_zh')
  }

  return { summaryEn, summaryZh }
}

export type LiveCaptionTranslateTarget = 'zh' | 'en'

export async function translateLiveCaptionChunk(
  text: string,
  apiKey: string,
  target: LiveCaptionTranslateTarget,
): Promise<string> {
  const trimmed = text.trim()
  if (!trimmed) return ''

  const system =
    target === 'zh'
      ? 'You translate live classroom captions. Output Simplified Chinese only. Keep natural lecture tone. Output only the translation, no quotes, labels, or explanations.'
      : 'You translate live classroom captions into natural English. Output only the translation, no quotes, labels, or explanations.'

  const res = await fetch(OPENAI_CHAT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: trimmed },
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(err || `Translate failed (${res.status})`)
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const out = data.choices?.[0]?.message?.content?.trim()
  if (!out) throw new Error('No translation in API response')
  return out
}
