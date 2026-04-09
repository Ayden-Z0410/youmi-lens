/**
 * Unified AI execution: Youmi AI (hosted) vs BYOK (server proxy).
 * No vendor names in thrown messages to UI - map in callers.
 */

import { getAiApiBase } from './apiBase'
import { getByokApiKey, getByokProvider, usesYoumiHosted } from './aiSource'
import { BYOK_PROVIDER_CAPABILITIES } from './providers/types'
import {
  summarizeLectureBilingual,
  transcribeWithWhisper,
  translateLiveCaptionChunk,
  type LiveCaptionTranslateTarget,
} from '../openai'

export type { LiveCaptionTranslateTarget }

function assertByokKey(): string {
  const k = getByokApiKey()
  if (!k) throw new Error('BYOK_KEY_MISSING')
  return k
}

export async function transcribeRecording(
  blob: Blob,
  filename: string,
  opts: { language?: string },
): Promise<string> {
  if (usesYoumiHosted()) {
    const form = new FormData()
    form.append('file', blob, filename)
    form.append('filename', filename)
    if (opts.language && /^[a-z]{2}$/i.test(opts.language)) {
      form.append('language', opts.language.toLowerCase())
    }
    const res = await fetch(`${getAiApiBase()}/transcribe`, { method: 'POST', body: form })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      const msg = (j as { error?: string }).error
      throw new Error(msg || 'AI_REQUEST_FAILED')
    }
    const data = (await res.json()) as { text?: string }
    if (!data.text) throw new Error('AI_EMPTY_TRANSCRIPT')
    return data.text
  }

  const provider = getByokProvider()
  if (!BYOK_PROVIDER_CAPABILITIES[provider].transcribe) {
    throw new Error('BYOK_TRANSCRIBE_UNSUPPORTED')
  }
  const apiKey = assertByokKey()
  const form = new FormData()
  form.append('file', blob, filename)
  form.append('filename', filename)
  form.append('provider', provider)
  form.append('apiKey', apiKey)
  if (opts.language && /^[a-z]{2}$/i.test(opts.language)) {
    form.append('language', opts.language.toLowerCase())
  }
  const res = await fetch(`${getAiApiBase()}/byok/transcribe`, { method: 'POST', body: form })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    const msg = (j as { error?: string }).error
    if (msg && typeof msg === 'string') throw new Error(`BYOK:${msg}`)
    throw new Error('AI_REQUEST_FAILED')
  }
  const data = (await res.json()) as { text?: string }
  if (!data.text) throw new Error('AI_EMPTY_TRANSCRIPT')
  return data.text
}

export async function summarizeRecording(
  transcript: string,
  meta: { course: string; title: string },
): Promise<{ summaryEn: string; summaryZh: string }> {
  if (usesYoumiHosted()) {
    const res = await fetch(`${getAiApiBase()}/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript,
        course: meta.course,
        title: meta.title,
      }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      const msg = (j as { error?: string }).error
      throw new Error(msg || 'AI_REQUEST_FAILED')
    }
    const data = (await res.json()) as { summary_en?: string; summary_zh?: string }
    const summaryEn = data.summary_en?.trim()
    const summaryZh = data.summary_zh?.trim()
    if (!summaryEn || !summaryZh) throw new Error('AI_BAD_SUMMARY')
    return { summaryEn, summaryZh }
  }

  const provider = getByokProvider()
  const apiKey = assertByokKey()
  const res = await fetch(`${getAiApiBase()}/byok/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider,
      apiKey,
      transcript,
      course: meta.course,
      title: meta.title,
    }),
  })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    const msg = (j as { error?: string }).error
    if (msg && typeof msg === 'string') throw new Error(`BYOK:${msg}`)
    throw new Error('AI_REQUEST_FAILED')
  }
  const data = (await res.json()) as { summary_en?: string; summary_zh?: string }
  const summaryEn = data.summary_en?.trim()
  const summaryZh = data.summary_zh?.trim()
  if (!summaryEn || !summaryZh) throw new Error('AI_BAD_SUMMARY')
  return { summaryEn, summaryZh }
}

export async function translateLiveCaption(
  text: string,
  opts: { target: LiveCaptionTranslateTarget },
): Promise<string> {
  if (usesYoumiHosted()) {
    const res = await fetch(`${getAiApiBase()}/translate-caption`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, target: opts.target }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      const msg = (j as { error?: string }).error
      throw new Error(msg || 'AI_REQUEST_FAILED')
    }
    const data = (await res.json()) as { text?: string }
    return (data.text ?? '').trim()
  }

  const provider = getByokProvider()
  const apiKey = assertByokKey()
  const res = await fetch(`${getAiApiBase()}/byok/translate-caption`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider,
      apiKey,
      text,
      target: opts.target,
    }),
  })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    const msg = (j as { error?: string }).error
    if (msg && typeof msg === 'string') throw new Error(`BYOK:${msg}`)
    throw new Error('AI_REQUEST_FAILED')
  }
  const data = (await res.json()) as { text?: string }
  return (data.text ?? '').trim()
}

/**
 * Local-only path: call OpenAI-compatible APIs directly from the browser (single-provider helper).
 * Used when IndexedDB recordings need BYOK without round-tripping multipart through our server for dev.
 */
export async function transcribeRecordingDirectOpenAI(
  blob: Blob,
  filename: string,
  apiKey: string,
  language?: string,
): Promise<string> {
  return transcribeWithWhisper(blob, apiKey, filename, { language })
}

export async function summarizeRecordingDirectOpenAI(
  transcript: string,
  apiKey: string,
  meta: { course: string; title: string },
): Promise<{ summaryEn: string; summaryZh: string }> {
  return summarizeLectureBilingual(transcript, apiKey, meta)
}

export async function translateLiveCaptionDirectOpenAI(
  text: string,
  apiKey: string,
  target: LiveCaptionTranslateTarget,
): Promise<string> {
  return translateLiveCaptionChunk(text, apiKey, target)
}
