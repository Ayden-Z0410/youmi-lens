/**
 * HTTP handlers for Youmi AI hosted routes (no vendor names in responses).
 */

import multer from 'multer'
import * as youmiHosted from './hosted/youmiHosted.mjs'
import { CLIENT_SAFE_UNAVAILABLE } from './errors.mjs'

export const hostedUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 26 * 1024 * 1024 },
})

function nodeBufferToArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

export async function handleHostedTranscribe(req, res) {
  const caps = youmiHosted.hostedCapabilities()
  if (!caps.transcribe) {
    res.status(503).json({ error: CLIENT_SAFE_UNAVAILABLE })
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
    const text = await youmiHosted.transcribeAudio(ab, mime, filename)
    res.json({ text })
  } catch (e) {
    console.warn('[hosted/transcribe]', e)
    res.status(503).json({ error: CLIENT_SAFE_UNAVAILABLE })
  }
}

export async function handleHostedSummarize(req, res) {
  const caps = youmiHosted.hostedCapabilities()
  if (!caps.summarize) {
    res.status(503).json({ error: CLIENT_SAFE_UNAVAILABLE })
    return
  }
  const transcript = req.body?.transcript
  const course = req.body?.course
  const title = req.body?.title
  if (!transcript || typeof transcript !== 'string') {
    res.status(400).json({ error: 'Invalid request' })
    return
  }
  try {
    const { summaryEn, summaryZh } = await youmiHosted.summarizeTranscript(transcript, course, title)
    res.json({ summary_en: summaryEn, summary_zh: summaryZh })
  } catch (e) {
    console.warn('[hosted/summarize]', e)
    res.status(503).json({ error: CLIENT_SAFE_UNAVAILABLE })
  }
}

export async function handleHostedTranslateCaption(req, res) {
  const caps = youmiHosted.hostedCapabilities()
  if (!caps.translate) {
    res.status(503).json({ error: CLIENT_SAFE_UNAVAILABLE })
    return
  }
  const text = req.body?.text
  const target = req.body?.target
  if (!text || typeof text !== 'string') {
    res.status(400).json({ error: 'Invalid request' })
    return
  }
  if (target !== 'zh' && target !== 'en') {
    res.status(400).json({ error: 'Invalid request' })
    return
  }
  try {
    const out = await youmiHosted.translateText(text, target)
    res.json({ text: out })
  } catch (e) {
    console.warn('[hosted/translate-caption]', e)
    res.status(503).json({ error: CLIENT_SAFE_UNAVAILABLE })
  }
}
