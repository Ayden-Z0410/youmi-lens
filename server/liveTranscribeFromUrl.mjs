/**
 * Live captions (Youmi AI): transcribe a short clip via a URL DashScope can fetch.
 * Separate from POST /api/transcribe (buffer/Whisper) and from POST /api/process-recording (full lecture).
 */

import { createClient } from '@supabase/supabase-js'
import * as youmiHosted from './ai/hosted/youmiHosted.mjs'
import { CLIENT_SAFE_UNAVAILABLE } from './ai/errors.mjs'

export async function handleLiveTranscribeFromUrl(req, res) {
  const rid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
  const caps = youmiHosted.hostedCapabilities()
  if (!caps.liveCaptions) {
    console.info('[YoumiLive][srv] live-transcribe-url rejected', JSON.stringify({ rid, reason: 'liveCaptions-cap-false' }))
    res.status(503).json({ error: CLIENT_SAFE_UNAVAILABLE })
    return
  }

  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : ''
  if (!url || !/^https:\/\//i.test(url)) {
    console.info('[YoumiLive][srv] live-transcribe-url bad body', JSON.stringify({ rid, hasUrl: Boolean(url) }))
    res.status(400).json({ error: 'Invalid request' })
    return
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  const jwt = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null
  if (!supabaseUrl || !anonKey || !jwt) {
    res.status(401).json({ error: 'Sign in again to continue.' })
    return
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) {
    res.status(401).json({ error: 'Sign in again to continue.' })
    return
  }

  let hostname
  try {
    hostname = new URL(url).hostname
  } catch {
    res.status(400).json({ error: 'Invalid request' })
    return
  }
  const supaHost = new URL(supabaseUrl).hostname
  if (hostname !== supaHost && !hostname.endsWith('.supabase.co')) {
    res.status(400).json({ error: 'Invalid request' })
    return
  }
  if (!url.includes(userId)) {
    console.info('[YoumiLive][srv] live-transcribe-url user mismatch', JSON.stringify({ rid, userId }))
    res.status(403).json({ error: 'Invalid request' })
    return
  }

  let pathSafe = ''
  try {
    pathSafe = new URL(url).pathname
  } catch {
    pathSafe = '?'
  }
  console.info(
    '[YoumiLive][srv] live-transcribe-url start',
    JSON.stringify({ rid, userId, urlHost: hostname, pathSuffix: pathSafe.slice(-64) }),
  )

  try {
    const text = await youmiHosted.transcribeAudioFromUrl(url)
    const t = text ?? ''
    console.info(
      '[YoumiLive][srv] paraformer/url-asr ok',
      JSON.stringify({ rid, textLen: t.length, preview: t.slice(0, 120) }),
    )
    res.json({ text: t })
  } catch (e) {
    console.warn('[YoumiLive][srv] url-asr error', rid, e)
    /**
     * Short browser WebM slices often fail Paraformer; full lectures use the same URL path but longer audio.
     * When OPENAI_API_KEY is set, re-fetch the same signed URL and run buffer Whisper (same as /api/transcribe).
     */
    const openai = process.env.OPENAI_API_KEY?.trim()
    const caps = youmiHosted.hostedCapabilities()
    if (openai && caps.transcribe) {
      try {
        const fr = await fetch(url)
        if (!fr.ok) throw new Error(`storage ${fr.status}`)
        const ab = await fr.arrayBuffer()
        const mime = fr.headers.get('content-type') || 'audio/webm'
        const ext = mime.includes('mp4') ? 'm4a' : mime.includes('wav') ? 'wav' : 'webm'
        const text = await youmiHosted.transcribeAudio(ab, mime, `live.${ext}`)
        const tw = text ?? ''
        console.info(
          '[YoumiLive][srv] whisper fallback ok',
          JSON.stringify({ rid, textLen: tw.length, preview: tw.slice(0, 120) }),
        )
        res.json({ text: tw })
        return
      } catch (e2) {
        console.warn('[YoumiLive][srv] whisper-fallback failed', rid, e2)
      }
    }
    console.info('[YoumiLive][srv] live-transcribe-url final 503', JSON.stringify({ rid }))
    res.status(503).json({ error: CLIENT_SAFE_UNAVAILABLE })
  }
}
