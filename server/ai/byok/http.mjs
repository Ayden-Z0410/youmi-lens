/**
 * BYOK HTTP proxy — keys only in request body, never stored server-side.
 */

import { hostedUpload } from '../hostedHttp.mjs'
import {
  byokProviderCapabilities,
  byokSummarize,
  byokTranscribeOpenai,
  byokTranslate,
} from './adapters.mjs'
import { CLIENT_SAFE_UNAVAILABLE } from '../errors.mjs'

const BYOK_TRANSCRIBE_UNSUPPORTED =
  'Speech-to-text is not available with your current advanced key setup. Change the connection type in Account or use Youmi AI.'

function nodeBufferToArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

export const byokTranscribeMiddleware = hostedUpload.single('file')

export async function handleByokTranscribe(req, res) {
  const provider = req.body?.provider
  const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : ''
  if (!apiKey || (provider !== 'openai' && provider !== 'deepseek' && provider !== 'qwen')) {
    res.status(400).json({ error: 'Invalid request' })
    return
  }
  if (!byokProviderCapabilities[provider]?.transcribe) {
    res.status(400).json({ error: BYOK_TRANSCRIBE_UNSUPPORTED })
    return
  }
  if (!req.file?.buffer) {
    res.status(400).json({ error: 'Invalid request' })
    return
  }
  const filename = (req.body?.filename && String(req.body.filename)) || 'lecture.webm'
  const mime = req.file.mimetype || 'application/octet-stream'
  try {
    const ab = nodeBufferToArrayBuffer(req.file.buffer)
    const text = await byokTranscribeOpenai(ab, mime, filename, apiKey)
    res.json({ text })
  } catch (e) {
    console.warn('[byok/transcribe]', e)
    res
      .status(400)
      .json({ error: 'Your API key could not be used for this request. Check the key and connection type in Account.' })
  }
}

export async function handleByokSummarize(req, res) {
  const provider = req.body?.provider
  const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : ''
  const transcript = req.body?.transcript
  const course = req.body?.course
  const title = req.body?.title
  if (!apiKey || !transcript || typeof transcript !== 'string') {
    res.status(400).json({ error: 'Invalid request' })
    return
  }
  if (provider !== 'openai' && provider !== 'deepseek' && provider !== 'qwen') {
    res.status(400).json({ error: 'Invalid request' })
    return
  }
  if (!byokProviderCapabilities[provider]?.summarize) {
    res.status(400).json({ error: CLIENT_SAFE_UNAVAILABLE })
    return
  }
  try {
    const out = await byokSummarize(provider, transcript, course, title, apiKey)
    res.json({ summary_en: out.summaryEn, summary_zh: out.summaryZh })
  } catch (e) {
    console.warn('[byok/summarize]', e)
    res
      .status(400)
      .json({ error: 'Your API key could not be used for this request. Check the key and connection type in Account.' })
  }
}

export async function handleByokTranslateCaption(req, res) {
  const provider = req.body?.provider
  const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : ''
  const text = req.body?.text
  const target = req.body?.target
  if (!apiKey || !text || typeof text !== 'string') {
    res.status(400).json({ error: 'Invalid request' })
    return
  }
  if (provider !== 'openai' && provider !== 'deepseek' && provider !== 'qwen') {
    res.status(400).json({ error: 'Invalid request' })
    return
  }
  if (target !== 'zh' && target !== 'en') {
    res.status(400).json({ error: 'Invalid request' })
    return
  }
  try {
    const out = await byokTranslate(provider, text, target, apiKey)
    res.json({ text: out })
  } catch (e) {
    console.warn('[byok/translate]', e)
    res
      .status(400)
      .json({ error: 'Your API key could not be used for this request. Check the key and connection type in Account.' })
  }
}
