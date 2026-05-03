/**
 * POST /api/upload-audio
 *
 * Proxies lecture audio uploads from the Tauri WKWebView to Supabase Storage,
 * bypassing WKWebView's unstable binary Blob fetch for large files.
 *
 * Request: multipart/form-data
 *   - file:         audio binary
 *   - recordingId:  UUID string
 *   - mime:         MIME type, e.g. "audio/webm" or "audio/mp4"
 *   - duration_sec: recording duration in seconds (optional, used for early duration check)
 * Headers:
 *   - Authorization: Bearer <supabase_access_token>
 *
 * Response: { storagePath, mime, size }
 *
 * Beta gate: enforces per-recording duration limit before uploading.
 * Quota (daily/monthly) is checked at process-recording time, not here.
 */

import multer from 'multer'
import { createClient } from '@supabase/supabase-js'
import {
  verifyJwt,
  getOrCreateUserQuota,
  checkUploadAllowed,
  recordBetaUsage,
  BETA_ERROR_CODES,
} from './betaGate.mjs'

const BUCKET = 'lecture-audio'
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024 // 500 MB

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

function makeAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export const audioUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
}).single('file')

function mimeToExt(mime) {
  if (!mime) return 'webm'
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('wav')) return 'wav'
  return 'webm'
}

export async function handleUploadAudio(req, res) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) {
    return res.status(401).json({
      error: BETA_ERROR_CODES.AUTH_REQUIRED,
      message: 'Sign in required to upload audio.',
    })
  }

  const user = await verifyJwt(token)
  if (!user) {
    return res.status(401).json({
      error: BETA_ERROR_CODES.AUTH_REQUIRED,
      message: 'Invalid or expired session. Sign in again.',
    })
  }
  const { userId, email } = user

  // ── Request validation ────────────────────────────────────────────────────
  const { recordingId, mime: rawMime, duration_sec: rawDuration } = req.body
  if (!recordingId || typeof recordingId !== 'string' || !/^[\w-]{8,}$/.test(recordingId)) {
    return res.status(400).json({ error: 'invalid_request', message: 'Invalid or missing recordingId' })
  }
  if (!req.file) {
    return res.status(400).json({ error: 'invalid_request', message: 'Missing file field' })
  }

  const mime = (rawMime || 'audio/webm').trim()
  const durationSec = rawDuration ? Number(rawDuration) : 0

  // ── Beta gate: per-recording duration check ───────────────────────────────
  if (durationSec > 0) {
    const quota = await getOrCreateUserQuota(userId, email)
    const gate = checkUploadAllowed(quota, durationSec)
    if (!gate.allowed) {
      console.warn(
        '[upload-audio] beta_gate_blocked',
        JSON.stringify({
          userId: userId.slice(0, 8),
          recordingId,
          durationSec,
          code: gate.body.error,
        }),
      )
      return res.status(gate.status).json(gate.body)
    }
  }

  // ── Storage upload ────────────────────────────────────────────────────────
  const ext = mimeToExt(mime)
  const storagePath = `${userId}/${recordingId}.${ext}`

  const adminClient = makeAdminClient()
  if (!adminClient) {
    console.error('[upload-audio] SUPABASE_SERVICE_ROLE_KEY not configured')
    return res.status(503).json({ error: 'server_error', message: 'Server storage not configured' })
  }

  console.warn(
    '[upload-audio] start',
    JSON.stringify({
      userId: `${userId.slice(0, 8)}…`,
      recordingId,
      storagePath,
      mime,
      bytes: req.file.size,
      durationSec,
      t: Date.now(),
    }),
  )

  const { error: upErr } = await adminClient.storage.from(BUCKET).upload(storagePath, req.file.buffer, {
    contentType: mime,
    upsert: true,
  })

  if (upErr) {
    console.error(
      '[upload-audio] storage error',
      JSON.stringify({
        userId: `${userId.slice(0, 8)}…`,
        recordingId,
        storagePath,
        error: upErr.message,
      }),
    )
    return res.status(502).json({ error: 'storage_error', message: `Storage upload failed: ${upErr.message}` })
  }

  // Log upload (non-billable, monitoring only)
  void recordBetaUsage(userId, email, recordingId, 'upload_audio', durationSec)

  console.warn(
    '[upload-audio] ok',
    JSON.stringify({ storagePath, bytes: req.file.size, t: Date.now() }),
  )

  return res.json({ storagePath, mime, size: req.file.size })
}
