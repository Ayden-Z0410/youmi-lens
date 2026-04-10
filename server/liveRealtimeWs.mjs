import { WebSocketServer } from 'ws'
import { createClient } from '@supabase/supabase-js'
import * as youmiHosted from './ai/hosted/youmiHosted.mjs'
import {
  createVolcengineStreamingSession,
  DEFAULT_VOLC_ASR_WS_URL,
  DEFAULT_VOLC_ASR_RESOURCE_ID,
  normalizeVolcAuthMode,
  AUTH_MODE_API_KEY,
} from './volcengineStreamingAsr.mjs'

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

export function attachLiveRealtimeWs(server) {
  const wss = new WebSocketServer({ server, path: '/api/live-realtime-ws' })
  console.log('[YoumiLive][srv] realtime ws route attached at /api/live-realtime-ws')
  console.log(
    '[YoumiLive][srv] realtime ws build marker',
    JSON.stringify({
      provider: 'volcengine-doubao-streaming-asr',
      version: '2026-04-10-volcengine-dual-auth',
      volcAuthMode: normalizeVolcAuthMode(process.env.VOLCENGINE_AUTH_MODE),
      hasSupabaseUrl: Boolean(SUPABASE_URL),
      hasServiceRole: Boolean(SUPABASE_SERVICE_ROLE_KEY),
      hasVolcAppKey: Boolean(process.env.VOLCENGINE_ASR_APP_KEY?.trim()),
      hasVolcAccessKey: Boolean(process.env.VOLCENGINE_ASR_ACCESS_KEY?.trim()),
      hasVolcAsrApiKey: Boolean(process.env.VOLCENGINE_ASR_API_KEY?.trim()),
      hasVolcEnvApiKey: Boolean(process.env.VOLCENGINE_API_KEY?.trim()),
      volcResourceIdFromEnv: Boolean(process.env.VOLCENGINE_ASR_RESOURCE_ID?.trim()),
      volcWsUrlFromEnv: Boolean(process.env.VOLCENGINE_ASR_WS_URL?.trim()),
    }),
  )

  wss.on('connection', (ws) => {
    console.log('[YoumiLive][srv] realtime ws connected')
    const wsSessionId = crypto.randomUUID().slice(-12)
    console.log('[YoumiLive][srv] realtime session created', JSON.stringify({ wsSessionId }))
    safeSend(ws, { type: 'ready' })

    let frameCount = 0
    // Active Volcengine streaming session for this connection.
    let streamingSession = null

    ws.on('message', async (raw, isBinary) => {
      // Binary frame = PCM audio → forward directly to Volcengine session.
      if (isBinary) {
        if (streamingSession) streamingSession.sendPcm(raw)
        return
      }

      let msg = null
      try {
        msg = JSON.parse(String(raw))
      } catch {
        safeSend(ws, { type: 'error', error: 'bad_json' })
        return
      }

      // ── Streaming session lifecycle ──────────────────────────────────────

      if (msg?.type === 'stream_start') {
        if (streamingSession) {
          streamingSession.destroy()
          streamingSession = null
        }

        const authMode = normalizeVolcAuthMode(process.env.VOLCENGINE_AUTH_MODE)
        const resourceId =
          process.env.VOLCENGINE_ASR_RESOURCE_ID?.trim() || DEFAULT_VOLC_ASR_RESOURCE_ID
        const wsUrl =
          process.env.VOLCENGINE_ASR_WS_URL?.trim() || DEFAULT_VOLC_ASR_WS_URL

        /** @type {{ authMode: string, appKey?: string, accessKey?: string, apiKey?: string, resourceId: string, wsUrl: string }} */
        let volcCreds
        if (authMode === AUTH_MODE_API_KEY) {
          const apiKey =
            process.env.VOLCENGINE_ASR_API_KEY?.trim() ||
            process.env.VOLCENGINE_API_KEY?.trim() ||
            process.env.VOLCENGINE_ASR_ACCESS_KEY?.trim()
          if (!apiKey) {
            console.warn('[YoumiLive][srv] Volcengine api_key mode: no token (VOLCENGINE_ASR_API_KEY / VOLCENGINE_API_KEY / VOLCENGINE_ASR_ACCESS_KEY)')
            safeSend(ws, {
              type: 'stream_error',
              message: 'VOLCENGINE_API_KEY_MODE_MISSING_TOKEN',
            })
            return
          }
          volcCreds = { authMode, apiKey, resourceId, wsUrl }
        } else {
          const appKey = process.env.VOLCENGINE_ASR_APP_KEY?.trim()
          const accessKey = process.env.VOLCENGINE_ASR_ACCESS_KEY?.trim()
          if (!appKey || !accessKey) {
            const missing = [!appKey && 'APP_KEY', !accessKey && 'ACCESS_KEY'].filter(Boolean).join(', ')
            console.warn('[YoumiLive][srv] Volcengine credentials missing:', missing)
            safeSend(ws, {
              type: 'stream_error',
              message: `VOLCENGINE_ASR_${missing.replace(/, /g, '_AND_')}_MISSING`,
            })
            return
          }
          volcCreds = { authMode, appKey, accessKey, resourceId, wsUrl }
        }

        const sampleRate = typeof msg.sampleRate === 'number' ? msg.sampleRate : 48000
        console.log(
          '[YoumiLive][srv] stream_start — Volc auth experiment',
          JSON.stringify({
            wsSessionId,
            sampleRate,
            authMode,
            hasXApiAppKey: authMode !== AUTH_MODE_API_KEY && Boolean(volcCreds.appKey),
            hasXApiAccessKey: authMode !== AUTH_MODE_API_KEY && Boolean(volcCreds.accessKey),
            hasAuthorization: authMode === AUTH_MODE_API_KEY,
            resourceId,
            wsUrl,
          }),
        )

        const clientRef = { ws }
        streamingSession = createVolcengineStreamingSession(
          volcCreds,
          {
            sampleRate,
            onReady: () => {
              console.log('[YoumiLive][srv] Volcengine ready → stream_ready', JSON.stringify({ wsSessionId }))
              safeSend(clientRef.ws, { type: 'stream_ready' })
            },
            onInterim: (text) => {
              if (clientRef.ws) safeSend(clientRef.ws, { type: 'stream_interim', text })
            },
            onFinal: (text) => {
              if (clientRef.ws) safeSend(clientRef.ws, { type: 'stream_final', text })
            },
            onError: (err) => {
              const errMsg = err instanceof Error ? err.message : String(err)
              console.log('[YoumiLive][srv] Volcengine error', JSON.stringify({ message: errMsg, wsSessionId }))
              if (clientRef.ws) safeSend(clientRef.ws, { type: 'stream_error', message: errMsg })
            },
            onClose: (intentional) => {
              console.log('[YoumiLive][srv] Volcengine session closed', JSON.stringify({ wsSessionId, intentional }))
              streamingSession = null
              clientRef.ws = null
              if (!intentional) {
                // Unexpected close — signal client to reconnect.
                console.log('[YoumiLive][srv] unexpected close — closing client WS', JSON.stringify({ wsSessionId }))
                try { ws.close() } catch { /* ignore */ }
              }
            },
          },
        )
        return
      }

      if (msg?.type === 'stream_stop') {
        console.log('[YoumiLive][srv] stream_stop', JSON.stringify({ wsSessionId }))
        streamingSession?.stop()   // graceful: sends LAST_PACKET, waits for server final
        return
      }

      // ── Legacy chunk-based transcription (after-class path, unchanged) ──
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
        let text = ''
        try {
          text = await youmiHosted.transcribeAudio(ab, mime, `live-${pass}.${ext}`)
        } catch (e) {
          const eMsg = e instanceof Error ? e.message : String(e)
          if (eMsg.includes('HOSTED_TRANSCRIBE_BUFFER_UNAVAILABLE')) {
            try {
              text = await transcribeViaSignedUrlFallback({ wsSessionId, id, pass, arrayBuffer: ab, mime })
            } catch (fallbackErr) {
              const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
              throw new Error(`LIVE_URL_FALLBACK_FAILED:${fallbackMsg}`)
            }
          } else {
            throw e
          }
        }
        safeSend(ws, { type: 'result', id, pass, text: (text || '').trim() })
      } catch (e) {
        safeSend(ws, {
          type: 'result',
          id,
          pass,
          error: e instanceof Error ? e.message : 'transcribe_failed',
        })
      }
    })

    ws.on('close', () => {
      console.log('[YoumiLive][srv] realtime ws closed', JSON.stringify({ wsSessionId }))
      streamingSession?.destroy()
      streamingSession = null
    })
  })

  return wss
}
