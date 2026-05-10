/**
 * HTTP handlers for Youmi AI hosted routes (no vendor names in responses).
 */

import multer from 'multer'
import * as youmiHosted from './hosted/youmiHosted.mjs'
import { CLIENT_SAFE_UNAVAILABLE } from './errors.mjs'
import {
  verifyJwt,
  getOrCreateUserQuota,
  checkHostedActionAllowed,
  recordBetaUsage,
  BETA_ERROR_CODES,
  BETA_LIMIT_MESSAGE,
} from '../betaGate.mjs'

export const hostedUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 26 * 1024 * 1024 },
})

function nodeBufferToArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

/** Extract and verify Bearer JWT from request. Returns { userId, email } or null. */
async function requireAuth(req, res) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) {
    res.status(401).json({ error: BETA_ERROR_CODES.AUTH_REQUIRED, message: 'Sign in required.' })
    return null
  }
  const user = await verifyJwt(token)
  if (!user) {
    res.status(401).json({ error: BETA_ERROR_CODES.AUTH_REQUIRED, message: 'Invalid or expired session. Sign in again.' })
    return null
  }
  return user
}

export async function handleHostedTranscribe(req, res) {
  const reqId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const t0 = Date.now()
  const marker = process.env.YOUMI_DEPLOY_MARKER || 'dev'

  // Auth
  const user = await requireAuth(req, res)
  if (!user) return

  const caps = youmiHosted.hostedCapabilities()
  if (!caps.transcribe) {
    console.warn('[hosted/transcribe] unavailable', JSON.stringify({ reqId, marker }))
    res.status(503).json({ error: CLIENT_SAFE_UNAVAILABLE })
    return
  }

  // Beta gate: direct hosted endpoint must be server-side protected.
  const quota = await getOrCreateUserQuota(user.userId, user.email)
  const gate = await checkHostedActionAllowed(quota, user.userId)
  if (!gate.allowed) {
    res.status(gate.status).json(gate.body)
    return
  }

  if (process.env.YOUMI_TRANSCRIBE_FORCE_TEST === '1') {
    console.warn(
      '[hosted/transcribe] FORCE_TEST',
      JSON.stringify({ reqId, marker, totalMs: Date.now() - t0 }),
    )
    res.json({ text: 'test' })
    return
  }

  if (!req.file?.buffer) {
    console.warn('[hosted/transcribe] bad_request', JSON.stringify({ reqId, marker }))
    res.status(400).json({ error: 'invalid_request', message: 'Invalid request' })
    return
  }

  const filename = (req.body?.filename && String(req.body.filename)) || 'lecture.webm'
  const mime = req.file.mimetype || 'application/octet-stream'

  try {
    const ab = nodeBufferToArrayBuffer(req.file.buffer)
    console.warn(
      '[hosted/transcribe] begin',
      JSON.stringify({ reqId, marker, bytes: req.file.buffer.length, mime, filename }),
    )
    const text = await youmiHosted.transcribeAudio(ab, mime, filename)
    console.warn(
      '[hosted/transcribe] ok',
      JSON.stringify({ reqId, marker, textLen: text?.length ?? 0, totalMs: Date.now() - t0 }),
    )
    void recordBetaUsage(user.userId, user.email, null, 'transcription', 0)
    res.json({ text })
  } catch (e) {
    console.warn(
      '[hosted/transcribe] fail',
      JSON.stringify({ reqId, marker, message: e instanceof Error ? e.message : String(e), totalMs: Date.now() - t0 }),
    )
    res.status(503).json({ error: CLIENT_SAFE_UNAVAILABLE })
  }
}

export async function handleHostedSummarize(req, res) {
  // Auth
  const user = await requireAuth(req, res)
  if (!user) return

  const caps = youmiHosted.hostedCapabilities()
  if (!caps.summarize) {
    res.status(503).json({ error: CLIENT_SAFE_UNAVAILABLE })
    return
  }

  // Beta gate: direct hosted endpoint must be server-side protected.
  const quota = await getOrCreateUserQuota(user.userId, user.email)
  const gate = await checkHostedActionAllowed(quota, user.userId)
  if (!gate.allowed) {
    res.status(gate.status).json(gate.body)
    return
  }

  const transcript = req.body?.transcript
  const course = req.body?.course
  const title = req.body?.title
  if (!transcript || typeof transcript !== 'string') {
    res.status(400).json({ error: 'invalid_request', message: 'Invalid request' })
    return
  }

  try {
    const { summaryEn, summaryZh } = await youmiHosted.summarizeTranscript(transcript, course, title)
    void recordBetaUsage(user.userId, user.email, null, 'summary_generation', 0)
    res.json({ summary_en: summaryEn, summary_zh: summaryZh })
  } catch (e) {
    console.warn('[hosted/summarize]', e)
    res.status(503).json({ error: CLIENT_SAFE_UNAVAILABLE })
  }
}

export async function handleHostedTranslateCaption(req, res) {
  // Auth (required, but no quota counting — high-frequency, low-cost per call)
  const user = await requireAuth(req, res)
  if (!user) return

  const caps = youmiHosted.hostedCapabilities()
  if (!caps.translate) {
    res.status(503).json({ error: CLIENT_SAFE_UNAVAILABLE })
    return
  }

  // Only block suspended users; active quota check not enforced here (live caption translation)
  const quota = await getOrCreateUserQuota(user.userId, user.email)
  if (quota?.status === 'suspended') {
    res.status(403).json({ error: BETA_ERROR_CODES.SUSPENDED, message: BETA_LIMIT_MESSAGE })
    return
  }

  const text = req.body?.text
  const target = req.body?.target
  if (!text || typeof text !== 'string') {
    res.status(400).json({ error: 'invalid_request', message: 'Invalid request' })
    return
  }
  if (target !== 'zh' && target !== 'en') {
    res.status(400).json({ error: 'invalid_request', message: 'Invalid request' })
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
