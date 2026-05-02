/**
 * POST /api/upload-audio
 *
 * Proxies lecture audio uploads from the Tauri WKWebView to Supabase Storage,
 * bypassing WKWebView's unstable binary Blob fetch for large files.
 *
 * Request: multipart/form-data
 *   - file:        audio binary (any size)
 *   - recordingId: UUID string
 *   - mime:        MIME type, e.g. "audio/webm" or "audio/mp4"
 * Headers:
 *   - Authorization: Bearer <supabase_access_token>
 *
 * Response: { storagePath, mime, size }
 */

import multer from 'multer'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'lecture-audio'
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024 // 500 MB

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

function makeAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function makeAnonClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''

  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header' })
  }

  // Verify JWT and extract userId via anon client
  const anonClient = makeAnonClient()
  if (!anonClient) {
    console.error('[upload-audio] SUPABASE_URL or SUPABASE_ANON_KEY not configured')
    return res.status(503).json({ error: 'Server not configured for auth' })
  }

  let userId
  try {
    const { data, error } = await anonClient.auth.getUser(token)
    if (error || !data?.user?.id) {
      console.warn('[upload-audio] auth failed', { error: error?.message })
      return res.status(401).json({ error: 'Invalid or expired session token' })
    }
    userId = data.user.id
  } catch (e) {
    console.error('[upload-audio] auth error', e?.message)
    return res.status(401).json({ error: 'Auth verification failed' })
  }

  const { recordingId, mime: rawMime } = req.body
  if (!recordingId || typeof recordingId !== 'string' || !/^[\w-]{8,}$/.test(recordingId)) {
    return res.status(400).json({ error: 'Invalid or missing recordingId' })
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Missing file field' })
  }

  const mime = (rawMime || 'audio/webm').trim()
  const ext = mimeToExt(mime)
  const storagePath = `${userId}/${recordingId}.${ext}`

  const adminClient = makeAdminClient()
  if (!adminClient) {
    console.error('[upload-audio] SUPABASE_SERVICE_ROLE_KEY not configured')
    return res.status(503).json({ error: 'Server storage not configured' })
  }

  console.warn(
    '[upload-audio] start',
    JSON.stringify({
      userId: `${userId.slice(0, 8)}…`,
      recordingId,
      storagePath,
      mime,
      bytes: req.file.size,
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
    return res.status(502).json({ error: `Storage upload failed: ${upErr.message}` })
  }

  console.warn(
    '[upload-audio] ok',
    JSON.stringify({ storagePath, bytes: req.file.size, t: Date.now() }),
  )

  return res.json({ storagePath, mime, size: req.file.size })
}
