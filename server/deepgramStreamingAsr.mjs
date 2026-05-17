/**
 * Deepgram Nova-3 real-time streaming ASR session.
 *
 * Unlike DashScope/Paraformer (batch decode, ~300–600ms per update), Deepgram
 * emits word-level interim results as each word is recognized (~50–150ms),
 * making captions feel continuous and speech-paced.
 *
 * Protocol:
 *   1. WS open → ready immediately (no handshake frame needed)
 *   2. Send raw binary PCM frames continuously
 *   3. Receive JSON Results messages:
 *        is_final: false  → interim (cumulative within current chunk)
 *        is_final: true   → chunk finalized (speech pause detected)
 *   4. Send { type: "CloseStream" } to flush remaining audio on stop
 *   5. Deepgram closes connection after sending remaining results
 *
 * Audio: PCM signed 16-bit LE, mono, sample_rate must match the URL param.
 *
 * Interface matches createDashscopeStreamingSession:
 *   createDeepgramStreamingSession(apiKey, { sampleRate, onReady, onInterim, onFinal, onError, onClose }, options)
 *   returns { sendPcm(buf), finish(), destroy() }
 */

import { WebSocket } from 'ws'

const DEEPGRAM_WS_BASE = 'wss://api.deepgram.com/v1/listen'
const SRV_DEEP_VERBOSE = process.env.YOUMI_LIVE_VERBOSE === '1'

/**
 * @param {string} apiKey  Deepgram API key
 * @param {{
 *   sampleRate?: number,
 *   onReady?: () => void,
 *   onInterim?: (text: string) => void,
 *   onFinal?: (text: string) => void,
 *   onError?: (err: Error) => void,
 *   onClose?: (intentional: boolean) => void,
 * }} callbacks
 * @param {{ wsSessionId?: string }} [options]
 * @returns {{ sendPcm(buf: Buffer|ArrayBuffer): void, finish(): void, destroy(): void }}
 */
export function createDeepgramStreamingSession(apiKey, callbacks = {}, options = {}) {
  const {
    sampleRate = 48000,
    onReady,
    onInterim,
    onFinal,
    onError,
    onClose,
  } = callbacks

  const wsSessionId = typeof options.wsSessionId === 'string' ? options.wsSessionId : ''
  const T_create = Date.now()
  const tag = Math.random().toString(36).slice(-6)

  const L = (msg, data) =>
    console.log(`[DeepgramStream][${tag}] ${msg}`, data !== undefined ? JSON.stringify(data) : '')

  let ws = null
  let destroyed = false
  let intentionalClose = false
  let T_ws_open = 0
  let T_first_interim = 0
  let interimCount = 0
  let finalCount = 0

  // ── Connection parameters ──────────────────────────────────────────────────
  // nova-3:         latest model, best English accuracy for lecture/academic speech
  // interim_results: true — key parameter; enables word-level streaming events
  // endpointing:    300ms silence before Deepgram sends is_final: true
  // utterance_end_ms: fires UtteranceEnd after 1s of silence (informational only)
  // smart_format:   formats numbers, dates, currencies naturally
  const params = new URLSearchParams({
    model: 'nova-3',
    language: 'en-US',
    encoding: 'linear16',
    sample_rate: String(sampleRate),
    channels: '1',
    interim_results: 'true',
    punctuate: 'true',
    smart_format: 'true',
    endpointing: '300',
    utterance_end_ms: '1000',
  })

  const wsUrl = `${DEEPGRAM_WS_BASE}?${params}`
  L('connecting', { sampleRate, wsSessionId, urlHint: wsUrl.slice(0, 80) })

  ws = new WebSocket(wsUrl, {
    headers: { Authorization: `Token ${apiKey}` },
  })

  ws.on('open', () => {
    T_ws_open = Date.now()
    const wsConnectMs = T_ws_open - T_create
    L('ws open — ready immediately (no handshake needed)', { wsConnectMs, wsSessionId })
    console.info(
      '[liveRealtimeWs] deepgram_upstream_connected',
      JSON.stringify({ taskTag: tag, wsSessionId, wsConnectMs }),
    )
    console.info(
      '[liveRealtimeWs] deepgram_open',
      JSON.stringify({ taskTag: tag, wsSessionId, wsConnectMs }),
    )
    // Deepgram accepts PCM immediately after WS open.
    onReady?.()
  })

  ws.on('message', (data) => {
    let msg
    try { msg = JSON.parse(String(data)) } catch { return }

    const type = msg?.type
    if (!type) return

    // Informational events — no action needed
    if (type === 'Metadata' || type === 'SpeechStarted' || type === 'UtteranceEnd') return

    if (type === 'Error') {
      const description = msg?.description || msg?.message || 'deepgram_unknown_error'
      L('server error', { description, variant: msg?.variant })
      onError?.(new Error(`DeepgramError: ${description}`))
      return
    }

    if (type !== 'Results') return

    const transcript = msg?.channel?.alternatives?.[0]?.transcript
    if (typeof transcript !== 'string' || !transcript.trim()) return

    const text = transcript.trim()
    const isFinal = msg.is_final === true
    const speechFinal = msg.speech_final === true
    const now = Date.now()

    if (isFinal || speechFinal) {
      finalCount++
      if (SRV_DEEP_VERBOSE) {
        L('final', {
          n: finalCount,
          isFinal,
          speechFinal,
          text: text.slice(0, 80),
          sinceOpenMs: T_ws_open ? now - T_ws_open : -1,
        })
      }
      onFinal?.(text)
    } else {
      interimCount++
      if (!T_first_interim) {
        T_first_interim = now
        const totalMs = T_first_interim - T_create
        const sinceOpenMs = T_ws_open ? T_first_interim - T_ws_open : -1
        L('TIMING first-interim', { totalMs, sinceOpenMs })
        console.info(
          '[liveRealtimeWs] deepgram_upstream_first_interim',
          JSON.stringify({ taskTag: tag, wsSessionId, totalMs, sinceOpenMs }),
        )
      }
      if (SRV_DEEP_VERBOSE) {
        L('interim', { n: interimCount, text: text.slice(0, 80) })
      }
      onInterim?.(text)
    }
  })

  ws.on('error', (err) => {
    L('ws error', { message: err?.message })
    console.warn(
      '[liveRealtimeWs] deepgram_upstream_error',
      JSON.stringify({
        wsSessionId,
        taskTag: tag,
        message: err instanceof Error ? err.message : String(err),
      }),
    )
    onError?.(err instanceof Error ? err : new Error(String(err)))
  })

  ws.on('close', (code, reason) => {
    const reasonStr = Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason || '')
    L('ws closed', { code, intentional: intentionalClose, reason: reasonStr.slice(0, 200) })
    console.warn(
      '[liveRealtimeWs] deepgram_upstream_closed',
      JSON.stringify({
        wsSessionId,
        taskTag: tag,
        closeCode: code,
        intentional: intentionalClose,
        interimCount,
        finalCount,
      }),
    )
    onClose?.(intentionalClose)
  })

  return {
    /** Send a raw PCM buffer (Int16 LE, mono) to Deepgram. */
    sendPcm(buf) {
      if (destroyed || !ws || ws.readyState !== WebSocket.OPEN) return
      try { ws.send(buf) } catch (e) { L('sendPcm error', { message: e?.message }) }
    },

    /** Graceful stop: tell Deepgram we are done sending audio, wait for trailing results. */
    finish() {
      if (destroyed || !ws || ws.readyState !== WebSocket.OPEN) return
      intentionalClose = true
      L('finish — sending CloseStream')
      try {
        ws.send(JSON.stringify({ type: 'CloseStream' }))
      } catch (e) {
        L('CloseStream send error', { message: e?.message })
      }
    },

    /** Hard teardown — close immediately without waiting for trailing results. */
    destroy() {
      if (destroyed) return
      destroyed = true
      intentionalClose = true
      L('destroy')
      try { ws?.close() } catch { /* ignore */ }
      ws = null
    },
  }
}
