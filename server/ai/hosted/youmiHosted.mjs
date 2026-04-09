/**
 * Youmi AI — hosted adapter (default product name; no vendor strings in API responses).
 * Internal implementation: Alibaba Model Studio (DashScope).
 * - Text: OpenAI-compatible chat at dashscope.aliyuncs.com/compatible-mode/v1
 * - Recorded speech: Paraformer file ASR (async task + result JSON) — official REST API
 *
 * Env (server only):
 * - DASHSCOPE_API_KEY — required for hosted speech (Paraformer) + preferred for chat (Qwen)
 * - YUMI_QWEN_CHAT_MODEL — default qwen-turbo
 * - YUMI_PARAFORMER_MODEL — default paraformer-v2
 * - YUMI_PARAFORMER_LANGUAGE_HINTS — comma list, default zh,en
 * - YUMI_HOSTED_TRANSCRIBE_IMPL — optional: openai_fallback (buffer /api/transcribe only; needs OPENAI_API_KEY)
 * - OPENAI_API_KEY — optional legacy fallback for chat + whisper when DashScope absent or transcribe fallback
 *
 * Live captions (near–real time): browser uploads each ~3s slice to Supabase Storage; server receives a signed
 * HTTPS URL and calls `transcribeAudioFromUrl` (Paraformer async). Same ASR stack as after-class file jobs,
 * different HTTP route and transport (URL vs full lecture pipeline).
 */

import { buildSummarizeMessages } from '../summarizePrompt.mjs'

/** Internal adapter id for logs and metrics (never shown in UI). */
export const HOSTED_ADAPTER_ID = 'qwenHosted'

const DASHSCOPE_COMPAT_CHAT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
const PARAFORMER_SUBMIT = 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription'
const OPENAI_AUDIO = 'https://api.openai.com/v1/audio/transcriptions'
const OPENAI_CHAT = 'https://api.openai.com/v1/chat/completions'

function safeUrlHost(u) {
  try {
    return new URL(u).hostname
  } catch {
    return 'invalid'
  }
}

const QWEN_CHAT_MODEL = process.env.YUMI_QWEN_CHAT_MODEL || 'qwen-turbo'
const OPENAI_CHAT_MODEL = process.env.YUMI_OPENAI_CHAT_MODEL || 'gpt-4o-mini'
const PARAFORMER_MODEL = process.env.YUMI_PARAFORMER_MODEL || 'paraformer-v2'
const STUB_ENABLED =
  process.env.ENABLE_STUB_AI === 'true' || process.env.VITE_ENABLE_STUB_AI === 'true'

function parseLanguageHints() {
  const raw = process.env.YUMI_PARAFORMER_LANGUAGE_HINTS || 'zh,en'
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.length ? parts : ['zh', 'en']
}

export function hostedCapabilities() {
  const hasDash = Boolean(process.env.DASHSCOPE_API_KEY?.trim())
  const hasOpenaiFallback = Boolean(process.env.OPENAI_API_KEY?.trim())
  if (STUB_ENABLED) {
    return {
      transcribe: true,
      translate: true,
      summarize: true,
      /** Live chunks use the buffer/Whisper path in `transcribeAudio` (see file header). */
      liveCaptions: true,
    }
  }
  return {
    /** Paraformer needs HTTPS URL; process-recording uses Supabase signed URLs. Buffer path optional via OpenAI. */
    transcribe: hasDash || hasOpenaiFallback,
    translate: hasDash || hasOpenaiFallback,
    summarize: hasDash || hasOpenaiFallback,
    /**
     * Live captions: use DashScope Paraformer via signed Storage URL (`/api/live-transcribe-url`), or the same
     * URL→download→Whisper path as after-class when only OPENAI is set. Optional: multipart `/api/transcribe` Whisper.
     */
    liveCaptions: hasDash || hasOpenaiFallback,
  }
}

export function hostedRuntimeMode() {
  if (STUB_ENABLED) return 'stub'
  if (process.env.DASHSCOPE_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim()) return 'hosted'
  return 'unconfigured'
}

/** Secret-safe env presence diagnostics for server health/logging. */
export function hostedEnvDiagnostics() {
  return {
    DASHSCOPE_API_KEY: Boolean(process.env.DASHSCOPE_API_KEY?.trim()),
    OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY?.trim()),
    YUMI_HOSTED_TRANSCRIBE_IMPL: process.env.YUMI_HOSTED_TRANSCRIBE_IMPL || '',
    YUMI_QWEN_CHAT_MODEL: process.env.YUMI_QWEN_CHAT_MODEL || 'qwen-turbo',
    YUMI_PARAFORMER_MODEL: process.env.YUMI_PARAFORMER_MODEL || 'paraformer-v2',
    ENABLE_STUB_AI: STUB_ENABLED,
  }
}

async function stubDelay(ms = 220) {
  await new Promise((r) => setTimeout(r, ms))
}

/** Prefer DashScope (Qwen); fall back to OpenAI chat for legacy / single-key deploys. */
async function chatCompleteJson(messages, opts = {}) {
  const dash = process.env.DASHSCOPE_API_KEY?.trim()
  if (dash) {
    const r = await fetch(DASHSCOPE_COMPAT_CHAT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${dash}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: opts.modelDash ?? opts.model ?? QWEN_CHAT_MODEL,
        temperature: opts.temperature ?? 0.3,
        ...(opts.responseFormat ? { response_format: opts.responseFormat } : {}),
        messages,
      }),
    })
    const raw = await r.text()
    if (!r.ok) {
      console.warn('[youmiHosted] dash chat', r.status, raw.slice(0, 200))
      throw new Error('HOSTED_CHAT_FAILED')
    }
    const data = JSON.parse(raw)
    return data.choices?.[0]?.message?.content ?? ''
  }

  const oa = process.env.OPENAI_API_KEY?.trim()
  if (!oa) throw new Error('HOSTED_TEXT_UNAVAILABLE')
  const r = await fetch(OPENAI_CHAT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${oa}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      temperature: opts.temperature ?? 0.3,
      ...(opts.responseFormat ? { response_format: opts.responseFormat } : {}),
      messages,
    }),
  })
  const raw = await r.text()
  if (!r.ok) {
    console.warn('[youmiHosted] openai chat fallback', r.status)
    throw new Error('HOSTED_CHAT_FAILED')
  }
  const data = JSON.parse(raw)
  return data.choices?.[0]?.message?.content ?? ''
}

/**
 * Recorded lecture transcription via DashScope Paraformer (official file ASR).
 * @param {string} fileUrl HTTPS URL reachable from DashScope (e.g. Supabase signed URL).
 */
export async function transcribeAudioFromUrl(fileUrl) {
  if (STUB_ENABLED) {
    await stubDelay()
    return `Demo transcript (${new Date().toLocaleTimeString()}): Lecture audio processed in local development mode.`
  }
  const key = process.env.DASHSCOPE_API_KEY?.trim()
  if (key) {
    console.warn('[youmiHosted] transcribeAudioFromUrl paraformer path', { urlHost: safeUrlHost(fileUrl) })
    const taskId = await submitParaformerTask(key, fileUrl)
    const output = await pollParaformerTask(key, taskId)
    const text = await transcriptTextFromParaformerOutput(output)
    console.warn('[youmiHosted] transcribeAudioFromUrl done', { textLen: text.length })
    return text
  }

  // Shared fallback: keep cloud processing usable when only OPENAI_API_KEY is configured.
  const openai = process.env.OPENAI_API_KEY?.trim()
  if (!openai) throw new Error('HOSTED_TRANSCRIBE_UNAVAILABLE')
  const fr = await fetch(fileUrl)
  if (!fr.ok) throw new Error('HOSTED_TRANSCRIBE_FAILED')
  const blob = await fr.blob()
  const mime = blob.type || 'audio/webm'
  const ext = mime.includes('mp4') ? 'm4a' : mime.includes('wav') ? 'wav' : 'webm'
  const ab = await blob.arrayBuffer()
  return transcribeAudio(ab, mime, `lecture.${ext}`)
}

async function submitParaformerTask(apiKey, fileUrl) {
  const r = await fetch(PARAFORMER_SUBMIT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({
      model: PARAFORMER_MODEL,
      input: { file_urls: [fileUrl] },
      parameters: {
        channel_id: [0],
        language_hints: parseLanguageHints(),
      },
    }),
  })
  const raw = await r.text()
  if (!r.ok) {
    console.warn('[youmiHosted] paraformer submit', r.status, raw.slice(0, 400))
    throw new Error('HOSTED_TRANSCRIBE_FAILED')
  }
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('HOSTED_TRANSCRIBE_FAILED')
  }
  const taskId = data.output?.task_id
  if (!taskId) throw new Error('HOSTED_TRANSCRIBE_FAILED')
  console.warn('[youmiHosted] paraformer submit ok', { taskId })
  return taskId
}

async function pollParaformerTask(apiKey, taskId) {
  const url = `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`
  const maxMs = Number(process.env.YUMI_PARAFORMER_POLL_MAX_MS || 600_000)
  const intervalMs = Number(process.env.YUMI_PARAFORMER_POLL_INTERVAL_MS || 500)
  const t0 = Date.now()
  let pollN = 0

  while (Date.now() - t0 < maxMs) {
    pollN += 1
    /** Prefer GET (documented for DashScope tasks); retry POST for older/alternate gateway behavior. */
    let r = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })
    if (r.status === 405 || r.status === 404) {
      r = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable',
        },
      })
    }
    const raw = await r.text()
    if (!r.ok) {
      console.warn('[youmiHosted] paraformer poll', r.status, raw.slice(0, 300))
      throw new Error('HOSTED_TRANSCRIBE_FAILED')
    }
    let data
    try {
      data = JSON.parse(raw)
    } catch {
      throw new Error('HOSTED_TRANSCRIBE_FAILED')
    }
    const out = data.output
    const status = out?.task_status
    if (pollN === 1 || pollN % 20 === 0 || status === 'SUCCEEDED' || status === 'FAILED') {
      console.warn('[youmiHosted] paraformer poll', {
        taskId,
        pollN,
        task_status: status,
        elapsedMs: Date.now() - t0,
      })
    }
    if (status === 'SUCCEEDED') {
      return out
    }
    if (status === 'FAILED' || status === 'UNKNOWN') {
      console.warn('[youmiHosted] paraformer task failed', status, raw.slice(0, 400))
      throw new Error('HOSTED_TRANSCRIBE_FAILED')
    }
    await new Promise((res) => setTimeout(res, intervalMs))
  }
  console.warn('[youmiHosted] paraformer poll timeout', { taskId, maxMs })
  throw new Error('HOSTED_TRANSCRIBE_TIMEOUT')
}

async function transcriptTextFromParaformerOutput(output) {
  const results = output?.results
  if (!Array.isArray(results) || !results.length) {
    return ''
  }
  const r0 = results[0]
  if (r0.subtask_status !== 'SUCCEEDED') {
    console.warn('[youmiHosted] paraformer subtask', r0.code, r0.message)
    return ''
  }
  const tUrl = r0.transcription_url
  if (!tUrl || typeof tUrl !== 'string') {
    throw new Error('HOSTED_TRANSCRIBE_FAILED')
  }
  const jr = await fetch(tUrl)
  if (!jr.ok) {
    console.warn('[youmiHosted] transcription_url fetch', jr.status)
    throw new Error('HOSTED_TRANSCRIBE_FAILED')
  }
  const json = await jr.json()
  const transcripts = json.transcripts
  if (!Array.isArray(transcripts) || !transcripts.length) {
    return ''
  }
  const fromParagraphs = transcripts
    .map((t) => {
      const raw =
        typeof t.text === 'string'
          ? t.text
          : typeof t.transcript === 'string'
            ? t.transcript
            : ''
      return raw.trim()
    })
    .filter(Boolean)
  if (fromParagraphs.length) {
    return fromParagraphs.join('\n').trim()
  }
  const parts = []
  for (const t of transcripts) {
    for (const s of t.sentences || []) {
      const piece = (s.text || '') + (s.punctuation || '')
      if (piece) parts.push(piece)
    }
  }
  return parts.join(' ').trim()
}

/**
 * Buffer-based transcribe (e.g. POST /api/transcribe with multipart).
 * DashScope Paraformer does not accept raw uploads per official docs — only public URLs.
 * When YUMI_HOSTED_TRANSCRIBE_IMPL=openai_fallback and OPENAI_API_KEY is set, uses Whisper.
 */
export async function transcribeAudio(arrayBuffer, mime, filename) {
  if (STUB_ENABLED) {
    await stubDelay(120)
    return `Demo live caption: ${filename} (${mime || 'audio'})`
  }
  const openaiKey = process.env.OPENAI_API_KEY?.trim()
  if (!openaiKey) {
    throw new Error('HOSTED_TRANSCRIBE_BUFFER_UNAVAILABLE')
  }

  const u8 = new Uint8Array(arrayBuffer)
  const body = new FormData()
  if (typeof File !== 'undefined') {
    body.append('file', new File([u8], filename, { type: mime }))
  } else {
    body.append('file', new Blob([u8], { type: mime }), filename)
  }
  body.append('model', 'whisper-1')

  const r = await fetch(OPENAI_AUDIO, {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}` },
    body,
  })
  const text = await r.text()
  if (!r.ok) {
    console.warn('[youmiHosted] transcribe openai fallback', r.status)
    throw new Error('HOSTED_TRANSCRIBE_FAILED')
  }
  const json = JSON.parse(text)
  return json.text ?? ''
}

export async function translateText(text, target) {
  if (STUB_ENABLED) {
    await stubDelay(90)
    return target === 'zh' ? `【开发演示】${text}` : `[Demo] ${text}`
  }
  if (target !== 'zh' && target !== 'en') throw new Error('BAD_TARGET')
  const system =
    target === 'zh'
      ? 'You translate live classroom captions. Output Simplified Chinese only. Keep natural lecture tone. Output only the translation, no quotes, labels, or explanations.'
      : 'You translate live classroom captions into natural English. Output only the translation, no quotes, labels, or explanations.'
  const out = await chatCompleteJson(
    [
      { role: 'system', content: system },
      { role: 'user', content: text.trim() },
    ],
    { temperature: 0.2, modelDash: QWEN_CHAT_MODEL },
  )
  return out.trim()
}

export async function summarizeTranscript(transcript, course, title) {
  console.warn('[youmiHosted] summarizeTranscript begin', { courseLen: course?.length, titleLen: title?.length })
  if (STUB_ENABLED) {
    await stubDelay(180)
    const label = [course, title].filter(Boolean).join(' - ') || 'Lecture'
    return {
      summaryEn: `Demo summary for ${label}. Key points were generated in stub mode for local development.`,
      summaryZh: `${label} 的演示摘要：当前为本地开发 Stub 模式，内容用于流程验证。`,
    }
  }
  const messages = buildSummarizeMessages(transcript, course, title)
  const raw = await chatCompleteJson(messages, {
    temperature: 0.3,
    responseFormat: { type: 'json_object' },
    modelDash: QWEN_CHAT_MODEL,
  })
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('HOSTED_SUMMARY_PARSE')
  }
  const summaryEn = parsed.summary_en?.trim()
  const summaryZh = parsed.summary_zh?.trim()
  if (!summaryEn || !summaryZh) throw new Error('HOSTED_SUMMARY_SHAPE')
  console.warn('[youmiHosted] summarizeTranscript done', { summaryEnLen: summaryEn.length, summaryZhLen: summaryZh.length })
  return { summaryEn, summaryZh }
}
