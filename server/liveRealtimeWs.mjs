import { WebSocketServer } from 'ws'
import { createClient } from '@supabase/supabase-js'
import * as youmiHosted from './ai/hosted/youmiHosted.mjs'
import {
  createVolcengineStreamingSession,
  DEFAULT_VOLC_ASR_WS_URL,
  DEFAULT_VOLC_ASR_RESOURCE_ID,
} from './volcengineStreamingAsr.mjs'
import { createDashscopeStreamingSession } from './dashscopeStreamingAsr.mjs'
import { getDashScopeHttpAttempts } from './dashscopeWithFallback.mjs'

/**
 * `/api/live-realtime-ws` — **single default realtime semantics** (Phase 1+2):
 *
 * 1. **Streaming (product):** JSON `stream_start` / `stream_stop` + **binary PCM frames** → upstream
 *    streaming ASR (DashScope by default; Volc only via `YOUMI_LIVE_ASR_EXPERIMENT`) → `stream_interim` /
 *    `stream_final` to the browser.
 * 2. **Legacy JSON `transcribe` + base64 audio:** OFF by default so this socket is not a second realtime
 *    protocol. Enable only for internal diagnostics: `YOUMI_LIVE_LEGACY_WS_TRANSCRIBE=1`.
 *
 * Volcengine streaming exists only when `YOUMI_LIVE_ASR_EXPERIMENT=volcengine|volc|vol` (internal experiment).
 * @returns {'dashscope' | 'volcengine'}
 */
function resolveLiveAsrProvider() {
  const exp = (process.env.YOUMI_LIVE_ASR_EXPERIMENT || '').trim().toLowerCase()
  if (exp === 'volcengine' || exp === 'volc' || exp === 'vol') return 'volcengine'
  return 'dashscope'
}

const SRV_LIVE_VERBOSE = process.env.YOUMI_LIVE_VERBOSE === '1'
const SRV_LIVE_DIAG = process.env.YOUMI_LIVE_DIAG === '1'
/** When unset/false, reject JSON `transcribe` on this WebSocket (binary PCM streaming only). */
const LEGACY_WS_TRANSCRIBE = process.env.YOUMI_LIVE_LEGACY_WS_TRANSCRIBE === '1'

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

  if (SRV_LIVE_VERBOSE) {
    console.log('[YoumiLive][srv] fallback: upload begin', JSON.stringify({ id, pass, pathSuffix: path.slice(-48) }))
  }
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
    if (SRV_LIVE_VERBOSE) {
      console.log('[YoumiLive][srv] fallback: paraformer from signed url', JSON.stringify({ id, pass }))
    }
    return await youmiHosted.transcribeAudioFromUrl(signed.signedUrl)
  } finally {
    await svc.storage.from(LIVE_BUCKET).remove([path]).catch(() => undefined)
  }
}

function liveAsrRoutingReason(activeProvider) {
  if (activeProvider === 'volcengine') return 'experiment_volcengine'
  return 'main_dashscope'
}

export function attachLiveRealtimeWs(server) {
  const wss = new WebSocketServer({ server, path: '/api/live-realtime-ws' })
  const activeProvider = resolveLiveAsrProvider()
  console.info(
    JSON.stringify({
      event: 'live_realtime_ws_ready',
      liveAsrProvider: activeProvider,
      routingReason: liveAsrRoutingReason(activeProvider),
    }),
  )
  console.info(
    `[YoumiLive][srv] live-realtime-ws ready (ASR=${activeProvider}; YOUMI_LIVE_VERBOSE=1 for per-chunk logs)`,
  )
  if (!LEGACY_WS_TRANSCRIBE) {
    console.info(
      '[YoumiLive][srv] legacy WS transcribe (JSON base64) disabled — use PCM streaming only, or set YOUMI_LIVE_LEGACY_WS_TRANSCRIBE=1 for diagnostics',
    )
  }

  wss.on('connection', (ws) => {
    const wsSessionId = crypto.randomUUID().slice(-12)
    const T_clientAccepted = Date.now()
    let T_streamStartJson = 0
    let T_firstClientPcm = 0
    let T_streamReadySent = 0
    let T_firstRelayInterim = 0
    console.info('[liveRealtimeWs] client_connected', JSON.stringify({ wsSessionId, t: T_clientAccepted }))
    console.info('[live-latency] srv_ws_accepted', JSON.stringify({ wsSessionId }))
    if (SRV_LIVE_VERBOSE) {
      console.log('[YoumiLive][srv] realtime ws connected', JSON.stringify({ wsSessionId }))
    }
    safeSend(ws, { type: 'ready' })

    let frameCount = 0
    let streamingSession = null
    /** PCM that arrives before stream_start finishes installing a session (rare race). */
    const pendingPcm = []
    const PENDING_PCM_CAP = 128
    const flushPendingPcm = () => {
      if (!streamingSession || pendingPcm.length === 0) return
      for (const buf of pendingPcm) streamingSession.sendPcm(buf)
      pendingPcm.length = 0
    }

    ws.on('message', async (raw, isBinary) => {
      // Binary frame = PCM → active live ASR session (main: DashScope).
      if (isBinary) {
        frameCount += 1
        if (!T_firstClientPcm) {
          T_firstClientPcm = Date.now()
          console.info(
            '[live-latency] srv_first_pcm_frame',
            JSON.stringify({
              wsSessionId,
              frameBytes: Buffer.isBuffer(raw) ? raw.length : Buffer.from(raw).length,
              msSinceWsAccepted: T_firstClientPcm - T_clientAccepted,
              msSinceStreamStartJson: T_streamStartJson ? T_firstClientPcm - T_streamStartJson : -1,
            }),
          )
        }
        if (SRV_LIVE_DIAG && (frameCount === 1 || frameCount % 50 === 0)) {
          const bytes = Buffer.isBuffer(raw) ? raw.length : Buffer.from(raw).length
          console.info(
            '[YoumiLive][srv] pcm frame',
            JSON.stringify({ wsSessionId, frameCount, bytes, hasStreamingSession: Boolean(streamingSession) }),
          )
        }
        if (streamingSession) streamingSession.sendPcm(raw)
        else if (pendingPcm.length < PENDING_PCM_CAP) pendingPcm.push(Buffer.isBuffer(raw) ? raw : Buffer.from(raw))
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
        T_streamStartJson = Date.now()
        console.info(
          '[liveRealtimeWs] stream_start_received',
          JSON.stringify({
            wsSessionId,
            msSinceWsAccepted: T_streamStartJson - T_clientAccepted,
          }),
        )
        pendingPcm.length = 0
        if (streamingSession) {
          streamingSession.destroy()
          streamingSession = null
        }

        const sampleRate   = typeof msg.sampleRate === 'number' ? msg.sampleRate : 48000
        const liveProvider = resolveLiveAsrProvider()
        const clientRef    = { ws }
        let streamReadySent = false
        const sendStreamReadyOnce = () => {
          if (streamReadySent) return
          streamReadySent = true
          T_streamReadySent = Date.now()
          console.info(
            '[live-latency] srv_stream_ready_sent',
            JSON.stringify({
              wsSessionId,
              msSinceStreamStartJson: T_streamStartJson ? T_streamReadySent - T_streamStartJson : -1,
              msSinceWsAccepted: T_streamReadySent - T_clientAccepted,
            }),
          )
          if (clientRef.ws) safeSend(clientRef.ws, { type: 'stream_ready' })
        }
        let relayInterimSeg = 0
        let relayFinalSeg   = 0

        const relayInterim = (text) => {
          relayInterimSeg += 1
          const open = clientRef.ws?.readyState === 1
          const preview = typeof text === 'string' ? text.slice(0, 80) : ''
          if (typeof text === 'string' && text.trim() && !T_firstRelayInterim) {
            T_firstRelayInterim = Date.now()
            console.info(
              '[live-latency] srv_first_interim_to_client',
              JSON.stringify({
                wsSessionId,
                msSinceStreamStartJson: T_streamStartJson ? T_firstRelayInterim - T_streamStartJson : -1,
                msSinceFirstClientPcm: T_firstClientPcm ? T_firstRelayInterim - T_firstClientPcm : -1,
                msSinceStreamReadySent: T_streamReadySent ? T_firstRelayInterim - T_streamReadySent : -1,
              }),
            )
            console.info(
              '[liveRealtimeWs] first_interim_to_client',
              JSON.stringify({ wsSessionId, previewLen: preview.length }),
            )
          }
          if (clientRef.ws) safeSend(clientRef.ws, { type: 'stream_interim', text })
          if (SRV_LIVE_VERBOSE) {
            console.log(
              '[YoumiLive][srv] relay stream_interim',
              JSON.stringify({
                wsSessionId,
                liveProvider,
                segId: relayInterimSeg,
                preview,
                clientWsOpen: open,
              }),
            )
          }
        }

        const relayFinal = (text) => {
          relayFinalSeg += 1
          const open = clientRef.ws?.readyState === 1
          const preview = typeof text === 'string' ? text.slice(0, 80) : ''
          if (clientRef.ws) safeSend(clientRef.ws, { type: 'stream_final', text })
          if (SRV_LIVE_VERBOSE) {
            console.log(
              '[YoumiLive][srv] relay stream_final',
              JSON.stringify({
                wsSessionId,
                liveProvider,
                segId: relayFinalSeg,
                preview,
                clientWsOpen: open,
              }),
            )
          }
        }

        if (liveProvider === 'dashscope') {
          const attempts = getDashScopeHttpAttempts()
          if (!attempts.length) {
            safeSend(ws, { type: 'stream_error', message: 'DASHSCOPE_KEY_MISSING' })
            return
          }
          if (SRV_LIVE_VERBOSE) {
            console.log(
              '[YoumiLive][srv] stream_start',
              JSON.stringify({ wsSessionId, sampleRate, liveProvider: 'dashscope', attempts: attempts.length }),
            )
          }

          const HANDSHAKE_MS = 8500
          let lastHandshakeErr = null
          for (const att of attempts) {
            let sessionWrapper = null
            try {
              const inner = await new Promise((resolve, reject) => {
                let settled = false
                /** @type {ReturnType<typeof createDashscopeStreamingSession> | null} */
                let sess = null
                const t = setTimeout(() => {
                  if (settled) return
                  settled = true
                  try {
                    sess?.destroy()
                  } catch {
                    /* ignore */
                  }
                  reject(new Error('DASHSCOPE_WS_HANDSHAKE_TIMEOUT'))
                }, HANDSHAKE_MS)
                sess = createDashscopeStreamingSession(
                  att.key,
                  {
                    sampleRate,
                    onReady: () => {
                      if (settled) return
                      settled = true
                      clearTimeout(t)
                      if (SRV_LIVE_VERBOSE) {
                        console.log(
                          '[YoumiLive][srv] dashscope ready → stream_ready',
                          JSON.stringify({ wsSessionId, attempt: att.tag }),
                        )
                      }
                      sendStreamReadyOnce()
                      resolve(sess)
                    },
                    onInterim: relayInterim,
                    onFinal: relayFinal,
                    onError: (err) => {
                      if (settled) return
                      settled = true
                      clearTimeout(t)
                      try {
                        sess?.destroy()
                      } catch {
                        /* ignore */
                      }
                      reject(err instanceof Error ? err : new Error(String(err)))
                    },
                    onClose: (intentional) => {
                      if (SRV_LIVE_VERBOSE) {
                        console.log(
                          '[YoumiLive][srv] live ASR session closed',
                          JSON.stringify({ wsSessionId, intentional, liveProvider, attempt: att.tag }),
                        )
                      }
                      if (!sessionWrapper || streamingSession !== sessionWrapper) return
                      streamingSession = null
                      if (!intentional) {
                        if (SRV_LIVE_VERBOSE) {
                          console.log(
                            '[YoumiLive][srv] unexpected close — closing client WS',
                            JSON.stringify({ wsSessionId }),
                          )
                        }
                        try {
                          ws.close()
                        } catch {
                          /* ignore */
                        }
                      }
                    },
                  },
                  { wsUrl: att.bases.wsInference },
                )
              })
              sessionWrapper = {
                sendPcm: (b) => inner.sendPcm(b),
                stop: () => inner.finish(),
                destroy: () => inner.destroy(),
              }
              streamingSession = sessionWrapper
              console.warn(
                '[DashScopeFallback] live_ws ok',
                JSON.stringify({ wsSessionId, attempt: att.tag, host: att.bases.wsInference.slice(0, 48) }),
              )
              flushPendingPcm()
              return
            } catch (e) {
              lastHandshakeErr = e
              const msg = e instanceof Error ? e.message : String(e)
              console.warn(
                '[DashScopeFallback] live_ws attempt failed',
                JSON.stringify({ wsSessionId, attempt: att.tag, message: msg.slice(0, 200) }),
              )
            }
          }
          const errMsg =
            lastHandshakeErr instanceof Error ? lastHandshakeErr.message : String(lastHandshakeErr || 'DASHSCOPE_SESSION_FAILED')
          safeSend(ws, { type: 'stream_error', message: errMsg })
          return
        }

        // ── Volc: experiment only (YOUMI_LIVE_ASR_EXPERIMENT); not the product main line. ──
        const resourceId =
          process.env.VOLCENGINE_ASR_RESOURCE_ID?.trim() || DEFAULT_VOLC_ASR_RESOURCE_ID
        const wsUrl =
          process.env.VOLCENGINE_ASR_WS_URL?.trim() || DEFAULT_VOLC_ASR_WS_URL

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

        /** @type {{ authMode: 'legacy_headers', appKey: string, accessKey: string, resourceId: string, wsUrl: string }} */
        const volcCreds = {
          authMode: 'legacy_headers',
          appKey,
          accessKey,
          resourceId,
          wsUrl,
        }

        if (SRV_LIVE_VERBOSE) {
          console.log(
            '[YoumiLive][srv] stream_start',
            JSON.stringify({ wsSessionId, sampleRate, liveProvider: 'volcengine' }),
          )
        }

        const volcWrapper = createVolcengineStreamingSession(volcCreds, {
          sampleRate,
          onReady: () => {
            if (SRV_LIVE_VERBOSE) {
              console.log('[YoumiLive][srv] volcengine ready → stream_ready', JSON.stringify({ wsSessionId }))
            }
            sendStreamReadyOnce()
          },
          onInterim: relayInterim,
          onFinal: relayFinal,
          onError: (err) => {
            const errMsg = err instanceof Error ? err.message : String(err)
            console.warn('[YoumiLive][srv] live ASR error', JSON.stringify({ message: errMsg, wsSessionId, liveProvider }))
            if (clientRef.ws) safeSend(clientRef.ws, { type: 'stream_error', message: errMsg })
          },
          onClose: (intentional) => {
            if (streamingSession !== volcWrapper) return
            if (SRV_LIVE_VERBOSE) {
              console.log(
                '[YoumiLive][srv] live ASR session closed',
                JSON.stringify({ wsSessionId, intentional, liveProvider }),
              )
            }
            streamingSession = null
            if (!intentional) {
              if (SRV_LIVE_VERBOSE) {
                console.log('[YoumiLive][srv] unexpected close — closing client WS', JSON.stringify({ wsSessionId }))
              }
              try { ws.close() } catch { /* ignore */ }
            }
          },
        })
        streamingSession = volcWrapper
        flushPendingPcm()
        return
      }

      if (msg?.type === 'stream_stop') {
        if (SRV_LIVE_VERBOSE) console.log('[YoumiLive][srv] stream_stop', JSON.stringify({ wsSessionId }))
        streamingSession?.stop()   // graceful: sends LAST_PACKET, waits for server final
        return
      }

      // ── Legacy JSON transcribe (diagnostic only; default off — do not mix with streaming PCM protocol) ──
      if (!msg || msg.type !== 'transcribe') return
      const id = typeof msg.id === 'string' ? msg.id : ''
      const passEarly = msg.pass === 'draft' ? 'draft' : 'final'
      if (!LEGACY_WS_TRANSCRIBE) {
        safeSend(ws, { type: 'result', id, pass: passEarly, error: 'legacy_ws_transcribe_disabled' })
        return
      }
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
          if (SRV_LIVE_VERBOSE) {
            console.log(
              '[YoumiLive][srv] ws frame rejected (capability)',
              JSON.stringify({ id, pass, frameCount, liveCaptions: caps.liveCaptions }),
            )
          }
          safeSend(ws, { type: 'result', id, pass, error: 'live_captions_unavailable' })
          return
        }
        const ab = decodeBase64ToArrayBuffer(audioBase64)
        const ext = mime.includes('mp4') ? 'm4a' : 'webm'
        if (SRV_LIVE_VERBOSE) {
          console.log(
            '[YoumiLive][srv] ws frame received',
            JSON.stringify({ id, pass, frameCount, mime, b64Len: audioBase64.length, bytes: ab.byteLength }),
          )
        }
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
      if (SRV_LIVE_VERBOSE) console.log('[YoumiLive][srv] realtime ws closed', JSON.stringify({ wsSessionId }))
      streamingSession?.destroy()
      streamingSession = null
    })
  })

  return wss
}
