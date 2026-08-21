/**
 * Cloud Library — authenticated audio retrieval.
 *
 * The canonical audio identity chain (proven, no translation table needed):
 *
 *   client lecture.id ("lecture_<uuid>")
 *     → remoteRecordingId ("<uuid>")
 *       → recordings.id ("<uuid>")
 *         → recordings.storage_path ("<user_id>/<uuid>.<ext>")
 *           → private `lecture-audio` Storage object
 *
 * A second client (Mac/Windows/another iPad) that has a Lecture ID can ask this
 * endpoint for the audio without knowing storage internals or old session ids:
 *
 *   GET /api/lectures/:id/audio
 *   Authorization: Bearer <supabase access token>
 *   → { lectureId, signedUrl, expiresInSec, mime, durationSec, title, aiStatus }
 *
 * Ownership: the row is looked up scoped to the authenticated user_id, so a user
 * can only ever retrieve their own audio — even though the admin client bypasses
 * RLS, the explicit `.eq('user_id', userId)` filter is the ownership gate. The
 * service-role key never leaves the server; only a short-lived signed URL does.
 */

import { verifyJwt, getAdminClient } from './betaGate.mjs'

const BUCKET = 'lecture-audio'
/** Signed URLs are short-lived; the client re-requests when one expires. */
const SIGNED_URL_TTL_SEC = Number(process.env.YUMI_LECTURE_AUDIO_SIGNED_URL_SEC || 900)

/** Accept either the bare recordings UUID or the client's "lecture_<uuid>" form. */
function normalizeLectureId(raw) {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  const stripped = trimmed.startsWith('lecture_') ? trimmed.slice('lecture_'.length) : trimmed
  // Supabase ids are UUIDs; guard against path traversal / junk.
  return /^[0-9a-fA-F-]{8,64}$/.test(stripped) ? stripped : ''
}

export async function handleGetLectureAudio(req, res) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  const user = await verifyJwt(token)
  if (!user) {
    return res.status(401).json({ error: 'auth_required', message: 'Sign in to retrieve audio.' })
  }
  const { userId } = user

  const recordingId = normalizeLectureId(req.params.id)
  if (!recordingId) {
    return res.status(400).json({ error: 'invalid_request', message: 'Invalid lecture id.' })
  }

  const db = getAdminClient()
  if (!db) {
    return res.status(503).json({ error: 'server_error', message: 'Storage not configured.' })
  }

  // Ownership gate: scoped to the authenticated user. A row owned by someone
  // else returns the same 404 as a missing row — existence is never leaked.
  const { data: row, error } = await db
    .from('recordings')
    .select('id, storage_path, mime, duration_sec, title, ai_status')
    .eq('id', recordingId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.warn('[lecture-audio] lookup failed', JSON.stringify({ recordingId, message: error.message }))
    return res.status(502).json({ error: 'lookup_failed', message: 'Could not resolve the lecture.' })
  }
  if (!row) {
    return res.status(404).json({ error: 'not_found', message: 'Lecture not found.' })
  }
  if (!row.storage_path) {
    // The lecture exists but has no cloud audio yet (local-only / upload pending).
    return res.status(409).json({ error: 'no_cloud_audio', message: 'No cloud audio for this lecture yet.' })
  }

  const { data: signed, error: signErr } = await db.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SEC)

  if (signErr || !signed?.signedUrl) {
    console.warn('[lecture-audio] signed url failed', JSON.stringify({ recordingId, message: signErr?.message ?? 'no url' }))
    return res.status(502).json({ error: 'signed_url_failed', message: 'Could not prepare the audio.' })
  }

  return res.status(200).json({
    lectureId: `lecture_${row.id}`,
    recordingId: row.id,
    signedUrl: signed.signedUrl,
    expiresInSec: SIGNED_URL_TTL_SEC,
    mime: row.mime ?? 'audio/mp4',
    durationSec: row.duration_sec ?? 0,
    title: row.title ?? null,
    aiStatus: row.ai_status ?? null,
  })
}
