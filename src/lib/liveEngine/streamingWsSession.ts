/**
 * Client-side streaming WebSocket session for live ASR (provider-agnostic).
 *
 * Protocol (/api/live-realtime-ws):
 *   1. WS open  ->  send { type: 'stream_start', sampleRate }
 *   2. Server responds { type: 'stream_ready' } once ASR provider is live
 *   3. Send binary ArrayBuffer frames (Int16 PCM continuously)
 *   4. Receive { type: 'stream_interim', text } for in-progress sentences
 *   5. Receive { type: 'stream_final', text } for completed sentences
 *   6. Send { type: 'stream_stop' } when recording ends
 *
 * Current server-side provider: Tencent Cloud Real-Time Speech Recognition.
 */

import { getAiApiBase } from '../ai/apiBase'

export type StreamingWsEvents = {
  /** WebSocket connection established; stream_start sent. ASR provider may not be ready yet. */
  onOpen?: () => void
  /** ASR provider confirmed live (stream_ready received). Safe to drain PCM queue now. */
  onReady?: () => void
  onInterim?: (text: string) => void
  onFinal?: (text: string) => void
  onError?: (reason: string) => void
  onClose?: () => void
}

function wsUrl(): string {
  const base = getAiApiBase()
  const trimmed = base.replace(/\/$/, '')
  if (/^wss?:\/\//i.test(trimmed)) return `${trimmed}/live-realtime-ws`
  if (/^https?:\/\//i.test(trimmed))
    return `${trimmed.replace(/^http/i, 'ws')}/live-realtime-ws`
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const rel = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return `${proto}://${window.location.host}${rel}/live-realtime-ws`
}

export class StreamingWsSession {
  private ws: WebSocket | null = null
  private events: StreamingWsEvents
  private sampleRate: number
  private destroyed = false
  private wsReady = false

  // Latency instrumentation (all in ms, from Date.now())
  private T_connect = 0
  private T_ws_open = 0
  private T_stream_ready = 0
  private T_first_interim = 0
  private T_first_final = 0
  private interimCount = 0

  constructor(sampleRate: number, events: StreamingWsEvents) {
    this.sampleRate = sampleRate
    this.events = events
  }

  connect() {
    if (this.destroyed) return
    this.T_connect = Date.now()
    const url = wsUrl()
    console.info('[StreamingWs] connecting', { url, sampleRate: this.sampleRate })
    const ws = new WebSocket(url)
    this.ws = ws
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      if (this.destroyed) { ws.close(); return }
      this.T_ws_open = Date.now()
      ws.send(JSON.stringify({ type: 'stream_start', sampleRate: this.sampleRate }))
      this.wsReady = true
      console.info('[StreamingWs] open -> stream_start sent', {
        sampleRate: this.sampleRate,
        wsConnectMs: this.T_ws_open - this.T_connect,
      })
      this.events.onOpen?.()
    }

    ws.onmessage = (ev: MessageEvent) => {
      let msg: Record<string, unknown>
      try { msg = JSON.parse(String(ev.data)) } catch { return }

      if (msg.type === 'stream_ready') {
        this.T_stream_ready = Date.now()
        console.info('[StreamingWs] ASR provider live (stream_ready)', {
          readyMs: this.T_stream_ready - this.T_connect,
        })
        this.events.onReady?.()
      } else if (msg.type === 'stream_interim' && typeof msg.text === 'string') {
        const now = Date.now()
        this.interimCount++
        if (!this.T_first_interim) {
          this.T_first_interim = now
          console.info('[StreamingWs] TIMING first-interim', {
            // KEY METRIC: how long from connect() until first word appears
            connectToFirstInterimMs: now - this.T_connect,
            // how long DashScope took to produce first result after task-started
            readyToFirstInterimMs: this.T_stream_ready ? now - this.T_stream_ready : -1,
            wsConnectMs: this.T_ws_open - this.T_connect,
            readyMs: this.T_stream_ready ? this.T_stream_ready - this.T_connect : -1,
          })
        }
        console.info('[StreamingWs] interim', {
          n: this.interimCount,
          len: (msg.text as string).length,
          sinceConnectMs: now - this.T_connect,
          preview: (msg.text as string).slice(0, 40),
        })
        this.events.onInterim?.(msg.text as string)
      } else if (msg.type === 'stream_final' && typeof msg.text === 'string') {
        const now = Date.now()
        if (!this.T_first_final) {
          this.T_first_final = now
          console.info('[StreamingWs] TIMING first-final', {
            connectToFinalMs: now - this.T_connect,
            interimToFinalMs: this.T_first_interim ? now - this.T_first_interim : -1,
          })
        }
        console.info('[StreamingWs] final', {
          len: (msg.text as string).length,
          sinceConnectMs: now - this.T_connect,
        })
        this.events.onFinal?.(msg.text as string)
      } else if (msg.type === 'stream_error') {
        const reason = typeof msg.message === 'string' ? msg.message : 'stream_error'
        console.warn('[StreamingWs] FAIL server error', { reason })
        this.events.onError?.(reason)
      }
    }

    ws.onerror = () => {
      if (!this.destroyed) this.events.onError?.('ws_connect_failed')
    }

    ws.onclose = () => {
      this.wsReady = false
      this.ws = null
      if (!this.destroyed) {
        console.info('[StreamingWs] closed')
        this.events.onClose?.()
      }
    }
  }

  /** Send a raw Int16 PCM ArrayBuffer to the server -> DashScope. */
  sendPcm(buffer: ArrayBuffer) {
    if (!this.wsReady || this.destroyed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(buffer)
  }

  /** Signal end of audio stream; DashScope will flush remaining text. */
  stop() {
    if (!this.ws || !this.wsReady) return
    try {
      this.ws.send(JSON.stringify({ type: 'stream_stop' }))
    } catch { /* ignore */ }
  }

  destroy() {
    this.destroyed = true
    this.wsReady = false
    if (this.ws) {
      try { this.ws.close() } catch { /* ignore */ }
      this.ws = null
    }
  }
}
