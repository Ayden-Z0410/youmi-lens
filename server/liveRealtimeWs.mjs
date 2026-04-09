import { WebSocketServer } from 'ws'
import { createClient } from '@supabase/supabase-js'
import * as youmiHosted from './ai/hosted/youmiHosted.mjs'
import { createDashscopeStreamingSession } from './dashscopeStreamingAsr.mjs'

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

// ---------------------------------------------------------------------------
// Server-side DashScope session pool
//
// DashScope task-started handshake from Railway (US/EU) to Alibaba Cloud (China)
// takes 3-6s due to cross-region TCP + TLS. Pre-warming at server startup means
// clients claim a ready session with near-zero first-interim latency.
//
// Pool stores one entry per sample rate (44100 and 48000 cover all Mac clients).
// Callbacks use a clientRef indirection to wire pool sessions to claiming clients.
// ---------------------------------------------------------------------------
const PREWARM_RATES = [44100, 48000]
const pool = new Map()  // sampleRate → { session, ready, clientRef }

function poolBuild(apiKey, sampleRate) {
  if (pool.has(sampleRate)) return
  const T_build = Date.now()
  const clientRef = { ws: null }
  console.log('[YoumiLive][pool] building standby', JSON.stringify({ sampleRate }))

  const session = createDashscopeStreamingSession(apiKey, {
    sampleRate,
    onReady: () => {
      const entry = pool.get(sampleRate)
      if (entry?.session === session) {
        entry.ready = true
        console.log('[YoumiLive][pool] standby READY', JSON.stringify({ sampleRate, buildMs: Date.now() - T_build }))
      }
      if (clientRef.ws) safeSend(clientRef.ws, { type: 'stream_ready' })
    },
    onInterim: (text) => { if (clientRef.ws) safeSend(clientRef.ws, { type: 'stream_interim', text }) },
    onFinal:   (text) => { if (clientRef.ws) safeSend(clientRef.ws, { type: 'stream_final',   text }) },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.log('[YoumiLive][pool] standby error', JSON.stringify({ sampleRate, message: msg }))
      if (clientRef.ws) safeSend(clientRef.ws, { type: 'stream_error', message: msg })
      if (pool.get(sampleRate)?.session === session) pool.delete(sampleRate)
    },
    onClose: (intentional) => {
      const isUnclaimed = !clientRef.ws
      if (pool.get(sampleRate)?.session === session) pool.delete(sampleRate)
      console.log('[YoumiLive][pool] standby closed', JSON.stringify({ sampleRate, intentional, isUnclaimed }))
      if (clientRef.ws && !intentional) {
        try { clientRef.ws.close() } catch { /* ignore */ }
      }
      // Unclaimed session closed (DashScope timeout) — rebuild automatically.
      if (isUnclaimed) setTimeout(() => poolBuild(apiKey, sampleRate), 2000)
    },
  })

  pool.set(sampleRate, { session, ready: false, clientRef })
}

function poolClaim(sampleRate, ws) {
  const entry = pool.get(sampleRate)
  if (!entry) return null
  pool.delete(sampleRate)
  entry.clientRef.ws = ws
  return entry
}

export function attachLiveRealtimeWs(server) {
  const wss = new WebSocketServer({ server, path: '/api/live-realtime-ws' })
  console.log('[YoumiLive][srv] realtime ws route attached at /api/live-realtime-ws')
  console.log(
    '[YoumiLive][srv] realtime ws build marker',
    JSON.stringify({
      provider: 'dashscope-paraformer-realtime-v2',
      version: '2026-04-09-continuity-first-v1',
      hasSupabaseUrl: Boolean(SUPABASE_URL),
      hasServiceRole: Boolean(SUPABASE_SERVICE_ROLE_KEY),
      hasDashscopeKey: Boolean(process.env.DASHSCOPE_API_KEY?.trim()),
    }),
  )

  // Pre-warm DashScope sessions at server startup so the first user gets stream_ready
  // without the 3-6s cross-Pacific handshake cost.
  const startupApiKey = process.env.DASHSCOPE_API_KEY?.trim()
  if (startupApiKey) {
    for (const sr of PREWARM_RATES) poolBuild(startupApiKey, sr)
  } else {
    console.warn('[YoumiLive][pool] DASHSCOPE_API_KEY not set — skipping pre-warm')
  }

  wss.on('connection', (ws) => {
    console.log('[YoumiLive][srv] realtime ws connected')
    let frameCount = 0
    const wsSessionId = crypto.randomUUID().slice(-12)
    console.log('[YoumiLive][srv] realtime session created', JSON.stringify({ wsSessionId }))
    safeSend(ws, { type: 'ready' })

    // Active DashScope streaming session for this connection (one per client WS).
    // Session persists for the entire recording — continuity-first design.
    let streamingSession = null

    ws.on('message', async (raw, isBinary) => {
      // Binary frame = PCM audio → forward directly to DashScope.
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

      // --- Streaming session control ---
      if (msg?.type === 'stream_start') {
        if (streamingSession) {
          streamingSession.destroy()
          streamingSession = null
        }
        const apiKey = process.env.DASHSCOPE_API_KEY?.trim()
        if (!apiKey) {
          console.warn('[YoumiLive][srv] DASHSCOPE_API_KEY not set')
          safeSend(ws, { type: 'stream_error', message: 'DASHSCOPE_API_KEY_MISSING' })
          return
        }
        const sampleRate = typeof msg.sampleRate === 'number' ? msg.sampleRate : 48000
        console.log('[YoumiLive][srv] stream_start', JSON.stringify({ wsSessionId, sampleRate, poolReady: pool.get(sampleRate)?.ready ?? false }))

        // Try to claim a pre-warmed session.
        const poolEntry = poolClaim(sampleRate, ws)
        if (poolEntry) {
          streamingSession = poolEntry.session
          if (poolEntry.ready) {
            console.log('[YoumiLive][srv] pool claim — instant stream_ready', JSON.stringify({ wsSessionId, sampleRate }))
            safeSend(ws, { type: 'stream_ready' })
          } else {
            console.log('[YoumiLive][srv] pool claim — still warming, onReady will fire', JSON.stringify({ wsSessionId, sampleRate }))
          }
          // Rebuild standby for the next client.
          setTimeout(() => poolBuild(apiKey, sampleRate), 0)
          return
        }

        // Pool miss (server restart or unexpected sample rate) — create fresh session.
        console.log('[YoumiLive][srv] pool miss — creating new DashScope session', JSON.stringify({ wsSessionId, sampleRate }))
        const clientRef = { ws }
        streamingSession = createDashscopeStreamingSession(apiKey, {
          sampleRate,
          onReady: () => {
            console.log('[YoumiLive][srv] DashScope task-started → stream_ready', JSON.stringify({ wsSessionId }))
            safeSend(ws, { type: 'stream_ready' })
          },
          onInterim: (text) => { if (clientRef.ws) safeSend(clientRef.ws, { type: 'stream_interim', text }) },
          onFinal:   (text) => { if (clientRef.ws) safeSend(clientRef.ws, { type: 'stream_final',   text }) },
          onError: (err) => {
            const errMsg = err instanceof Error ? err.message : String(err)
            console.log('[YoumiLive][srv] DashScope error', JSON.stringify({ message: errMsg, wsSessionId }))
            if (clientRef.ws) safeSend(clientRef.ws, { type: 'stream_error', message: errMsg })
          },
          onClose: (intentional) => {
            console.log('[YoumiLive][srv] DashScope session closed', JSON.stringify({ wsSessionId, intentional }))
            streamingSession = null
            clientRef.ws = null
            if (!intentional) {
              console.log('[YoumiLive][srv] unexpected close — closing client WS to trigger reconnect', JSON.stringify({ wsSessionId }))
              try { ws.close() } catch { /* ignore */ }
            }
          },
        })
        return
      }

      if (msg?.type === 'stream_stop') {
        console.log('[YoumiLive][srv] stream_stop', JSON.stringify({ wsSessionId }))
        streamingSession?.finish()
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
      streamingSession?.destroy()
      streamingSession = null
    })

  })

  return wss
}

