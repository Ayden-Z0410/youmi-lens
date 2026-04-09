import { WebSocketServer } from 'ws'
import { createClient } from '@supabase/supabase-js'
import * as youmiHosted from './ai/hosted/youmiHosted.mjs'

function safeSend(ws, payload) {
  try {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload))
  } catch {
    /* ignore closed socket */
  }
}

function decodeBase64ToArrayBuffer(b64) {
  const buf = Buffer.from(b64, 'base64')
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const LIVE_BUCKET = 'lecture-audio'

function makeServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function transcribeViaSignedUrlFallback({ wsSessionId, id, pass, arrayBuffer, mime }) {
  const svc = makeServiceClient()
  if (!svc) throw new Error('LIVE_URL_FALLBACK_UNAVAILABLE')
  const ext = mime.includes('mp4') ? 'm4a' : 'webm'
  const path = `_live-realtime/${wsSessionId}/${id}-${pass}.${ext}`
  const body = new Blob([new Uint8Array(arrayBuffer)], { type: mime || 'audio/webm' })

  console.log('[YoumiLive][srv] fallback: upload begin', JSON.stringify({ id, pass, pathSuffix: path.slice(-48) }))
  const { error: upErr } = await svc.storage.from(LIVE_BUCKET).upload(path, body, {
    contentType: mime || `audio/${ext}`,
    upsert: true,
  })
  if (upErr) throw new Error(`LIVE_URL_FALLBACK_UPLOAD_FAILED:${upErr.message}`)

  const { data: signed, error: signErr } = await svc.storage.from(LIVE_BUCKET).createSignedUrl(path, 180)
  if (signErr || !signed?.signedUrl) {
    await svc.storage.from(LIVE_BUCKET).remove([path]).catch(() => undefined)
    throw new Error(`LIVE_URL_FALLBACK_SIGN_FAILED:${signErr?.message ?? 'no_url'}`)
  }

  try {
    console.log('[YoumiLive][srv] fallback: paraformer from signed url', JSON.stringify({ id, pass }))
    return await youmiHosted.transcribeAudioFromUrl(signed.signedUrl)
  } finally {
    await svc.storage.from(LIVE_BUCKET).remove([path]).catch(() => undefined)
  }
}

/**
 * Realtime-ish socket for live captions:
 * - `draft`: shorter audio slice for fast first text
 * - `final`: full slice for stable text
 */
export function attachLiveRealtimeWs(server) {
  const wss = new WebSocketServer({ server, path: '/api/live-realtime-ws' })
  console.log('[YoumiLive][srv] realtime ws route attached at /api/live-realtime-ws')
  console.log(
    '[YoumiLive][srv] realtime ws build marker',
    JSON.stringify({
      fallbackVersion: '2026-04-08-fallback-v2',
      hasSupabaseUrl: Boolean(SUPABASE_URL),
      hasServiceRole: Boolean(SUPABASE_SERVICE_ROLE_KEY),
    }),
  )

  wss.on('connection', (ws) => {
    console.log('[YoumiLive][srv] realtime ws connected')
    let frameCount = 0
    const wsSessionId = crypto.randomUUID().slice(-12)
    console.log('[YoumiLive][srv] realtime session created', JSON.stringify({ wsSessionId }))
    safeSend(ws, { type: 'ready' })

    ws.on('message', async (raw) => {
      let msg = null
      try {
        msg = JSON.parse(String(raw))
      } catch {
        safeSend(ws, { type: 'error', error: 'bad_json' })
        return
      }

      if (!msg || msg.type !== 'transcribe') return
      const id = typeof msg.id === 'string' ? msg.id : ''
      const mime = typeof msg.mime === 'string' ? msg.mime : 'audio/webm'
      const audioBase64 = typeof msg.audioBase64 === 'string' ? msg.audioBase64 : ''
      const pass = msg.pass === 'draft' ? 'draft' : 'final'
      if (!id || !audioBase64) {
        safeSend(ws, { type: 'result', id, pass, error: 'bad_request' })
        return
      }
      frameCount += 1

      try {
        const caps = youmiHosted.hostedCapabilities()
        if (!caps.liveCaptions) {
          console.log(
            '[YoumiLive][srv] ws frame rejected (capability)',
            JSON.stringify({ id, pass, frameCount, liveCaptions: caps.liveCaptions }),
          )
          safeSend(ws, { type: 'result', id, pass, error: 'live_captions_unavailable' })
          return
        }
        const ab = decodeBase64ToArrayBuffer(audioBase64)
        const ext = mime.includes('mp4') ? 'm4a' : 'webm'
        console.log(
          '[YoumiLive][srv] ws frame received',
          JSON.stringify({ id, pass, frameCount, mime, b64Len: audioBase64.length, bytes: ab.byteLength }),
        )
        console.log('[YoumiLive][srv] transcribe buffer created', JSON.stringify({ id, pass, bytes: ab.byteLength }))
        console.log('[YoumiLive][srv] ws ASR started', JSON.stringify({ id, pass }))
        let text = ''
        try {
          text = await youmiHosted.transcribeAudio(ab, mime, `live-${pass}.${ext}`)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.log(
            '[YoumiLive][srv] raw buffer path failed',
            JSON.stringify({ id, pass, message: msg }),
          )
          if (msg.includes('HOSTED_TRANSCRIBE_BUFFER_UNAVAILABLE')) {
            console.log(
              '[YoumiLive][srv] fallback entered',
              JSON.stringify({ id, pass, wsSessionId }),
            )
            try {
              text = await transcribeViaSignedUrlFallback({
                wsSessionId,
                id,
                pass,
                arrayBuffer: ab,
                mime,
              })
            } catch (fallbackErr) {
              const fallbackMsg =
                fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
              console.log(
                '[YoumiLive][srv] fallback failed',
                JSON.stringify({ id, pass, message: fallbackMsg }),
              )
              throw new Error(`LIVE_URL_FALLBACK_FAILED:${fallbackMsg}`)
            }
          } else {
            throw e
          }
        }
        console.log(
          '[YoumiLive][srv] ws ASR result',
          JSON.stringify({ id, pass, textLen: (text || '').trim().length }),
        )
        safeSend(ws, { type: 'result', id, pass, text: (text || '').trim() })
        console.log('[YoumiLive][srv] ws result sent', JSON.stringify({ id, pass }))
      } catch (e) {
        console.log(
          '[YoumiLive][srv] ws ASR error',
          JSON.stringify({ id, pass, message: e instanceof Error ? e.message : String(e) }),
        )
        safeSend(ws, {
          type: 'result',
          id,
          pass,
          error: e instanceof Error ? e.message : 'transcribe_failed',
        })
      }
    })
    ws.on('close', () => {
      console.log('[YoumiLive][srv] realtime ws closed')
    })
  })

  return wss
}

