/**
 * YoumiLiveAdapter — PCM → server /api/live-realtime-ws (product main line: DashScope; Volc only server-side experiment).
 *
 * Design principles:
 *   • Provider delivers natural clause boundaries via VAD (definite:true = final).
 *   • No force-flush, no stall-commit, no synthetic-final patches needed.
 *   • On error/close → abandon in-flight segment (synthetic final) + reconnect.
 *   • Each ASR interim is emitted immediately (no client-side cadence) so text flows continuously.
 *
 * Segment lifecycle:
 *   First interim → create stream-N.
 *   Each interim  → immediate en_interim for stream-N.
 *   Provider final → en_final for stream-N; next interim will open stream-N+1.
 *
 * Audio flow:
 *   browser AudioContext (PCM Int16) → pushPcm() → StreamingWsSession (WS)
 *   → server ASR (DashScope default) → stream_interim / stream_final → adapter events
 */

import { StreamingWsSession } from '../streamingWsSession'

type YoumiAdapterEvent =
  | { type: 'connected' }
  | { type: 'reconnecting'; reason: string }
  | { type: 'closed' }
  | { type: 'en_interim'; segmentId: string; rev: number; text: string }
  | { type: 'en_final'; segmentId: string; text: string }
  | { type: 'error'; code: string; message: string; recoverable: boolean }

type YoumiAdapterListener = (event: YoumiAdapterEvent) => void

function log(tag: string, fields?: Record<string, unknown>) {
  if (fields) console.info(`[LiveEngine][YoumiAdapter] ${tag}`, JSON.stringify(fields))
  else console.info(`[LiveEngine][YoumiAdapter] ${tag}`)
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Speech onset threshold (Int16 ±32767). Filters out silence before first word.
const VOICE_ENERGY_THRESHOLD = 500

// PCM queue capacity while waiting for WS+ASR handshake.
// 50 frames × ~46 ms = ~2.3 s buffer — ample for the handshake window.
const PCM_QUEUE_CAP = 50

// ── YoumiLiveAdapter ──────────────────────────────────────────────────────────

export class YoumiLiveAdapter {
  private listener: YoumiAdapterListener | null = null
  private closed   = false
  private session: StreamingWsSession | null = null
  private sessionReady = false
  private activeRef: { active: boolean } = { active: false }

  // Per-segment state
  private currentSegId = ''
  private segCounter   = 0
  private interimRev   = 0
  private lastInterimMs  = 0

  // Latency diagnostics
  private speechOnsetMs    = 0
  private firstInterimLogged = false
  private lastFinalMs      = 0

  // PCM queue: holds audio received before the ASR session is ready.
  private pcmQueue: ArrayBuffer[] = []

  onEvent(listener: YoumiAdapterListener) {
    this.listener = listener
  }

  start() {
    this.closed        = false
    this.sessionReady  = false
    this.activeRef     = { active: false }
    this.currentSegId  = ''
    this.segCounter    = 0
    this.interimRev    = 0
    this.lastInterimMs = 0
    this.speechOnsetMs = 0
    this.firstInterimLogged = false
    this.lastFinalMs   = 0
    this.pcmQueue      = []
    log('adapter starting (live ASR: server DashScope main line)')
    this.listener?.({ type: 'connected' })
  }

  stop() {
    this.closed = true
    this.activeRef.active = false
    log('adapter stop')
    this.session?.stop()
    setTimeout(() => { this.session?.destroy(); this.session = null }, 500)
    this.listener?.({ type: 'closed' })
  }

  // ── Segment abandonment (on error / unexpected close) ─────────────────────

  private abandonCurrentSegment(reason: string) {
    const segId = this.currentSegId
    const text  = ''  // discard in-flight draft — content integrity > partial output
    this.currentSegId  = ''
    this.interimRev    = 0
    this.lastInterimMs = 0
    this.firstInterimLogged = false
    this.speechOnsetMs = 0
    if (segId) {
      log('synthetic final for abandoned segment', { reason, segId, nextSeg: `stream-${this.segCounter}` })
      this.listener?.({ type: 'en_final', segmentId: segId, text })
    }
  }

  // ── Audio input ───────────────────────────────────────────────────────────

  pushPcm(buffer: ArrayBuffer, sampleRate: number) {
    if (this.closed) return

    // Detect speech onset (first non-silent sample) for latency logging.
    if (!this.speechOnsetMs) {
      const samples = new Int16Array(buffer)
      for (let i = 0; i < samples.length; i++) {
        if (Math.abs(samples[i]) > VOICE_ENERGY_THRESHOLD) {
          this.speechOnsetMs = Date.now()
          log('speech-onset detected')
          break
        }
      }
    }

    if (!this.session) this.initSession(sampleRate)

    if (this.sessionReady) {
      this.session?.sendPcm(buffer)
    } else {
      this.pcmQueue.push(buffer)
      if (this.pcmQueue.length > PCM_QUEUE_CAP) this.pcmQueue.shift()  // drop oldest
    }
  }

  // ── Session lifecycle ─────────────────────────────────────────────────────

  private initSession(sampleRate: number) {
    const ref    = { active: true }
    this.activeRef = ref
    const T_init = Date.now()
    log('init streaming session (server live-realtime-ws)', { sampleRate, nextSeg: `stream-${this.segCounter}` })

    this.session = new StreamingWsSession(sampleRate, {
      onOpen: () => {
        if (!ref.active || this.closed) return
        // Send PCM as soon as the app WS is up (stream_start already sent). Avoids a deadlock
        // where some upstream ASR providers only finalize after receiving audio, but the client
        // previously waited for stream_ready before sending any PCM.
        this.sessionReady = true
        const q = this.pcmQueue
        this.pcmQueue = []
        for (const buf of q) this.session?.sendPcm(buf)
        log('WS open — sending PCM immediately', {
          drained: q.length,
          wsOpenMs: Date.now() - T_init,
        })
      },

      onReady: () => {
        if (!ref.active || this.closed) return
        this.sessionReady = true
        log('stream_ready — draining PCM queue', {
          queued: this.pcmQueue.length,
          readyMs: Date.now() - T_init,
          nextSeg: `stream-${this.segCounter}`,
        })
        this.listener?.({ type: 'connected' })
        for (const buf of this.pcmQueue) this.session?.sendPcm(buf)
        this.pcmQueue = []
      },

      onInterim: (text) => {
        if (!ref.active || this.closed || !text.trim()) return
        const now     = Date.now()
        const trimmed = text.trim()

        const isFirst = !this.currentSegId
        if (isFirst) {
          this.currentSegId = `stream-${this.segCounter++}`
          this.interimRev   = 0
          if (this.speechOnsetMs && !this.firstInterimLogged) {
            this.firstInterimLogged = true
            log('A-metric: speech-onset → first-interim', {
              onsetToFirstInterimMs: now - this.speechOnsetMs,
              segId: this.currentSegId,
            })
          }
          if (this.lastFinalMs) {
            log('inter-segment gap: last-final → first-interim', {
              gapMs: now - this.lastFinalMs, segId: this.currentSegId,
            })
          }
          log('new segment', {
            segId: this.currentSegId, firstWords: trimmed.slice(0, 60),
            sinceSessionInitMs: now - T_init,
          })
        }

        this.lastInterimMs = now
        const rev = ++this.interimRev
        // Hot path: no per-frame console — avoids main-thread jank when ASR sends many interims/sec.
        this.listener?.({ type: 'en_interim', segmentId: this.currentSegId, rev, text: trimmed })
      },

      onFinal: (text) => {
        if (!ref.active || this.closed || !text.trim()) return
        const now     = Date.now()
        const trimmed = text.trim()

        const segId = this.currentSegId || `stream-${this.segCounter++}`
        log('B-metric: last-interim → final', {
          lastInterimToFinalMs: this.lastInterimMs ? now - this.lastInterimMs : -1,
          gapSinceLastFinalMs:  this.lastFinalMs   ? now - this.lastFinalMs   : -1,
          segId,
        })
        log('en_final', { segId, len: trimmed.length, preview: trimmed.slice(0, 80) })

        this.currentSegId  = ''
        this.interimRev    = 0
        this.lastInterimMs = 0
        this.firstInterimLogged = false
        this.speechOnsetMs = 0
        this.lastFinalMs   = now

        this.listener?.({ type: 'connected' })
        this.listener?.({ type: 'en_final', segmentId: segId, text: trimmed })
        log('segment closed — waiting for next speech', { nextSeg: `stream-${this.segCounter}` })
      },

      onError: (reason) => {
        if (!ref.active || this.closed) return
        log('RECONNECT — session error', { reason, segId: this.currentSegId || '(none)' })
        ref.active = false
        this.sessionReady = false
        const dying = this.session
        this.session = null
        setTimeout(() => dying?.destroy(), 0)
        this.abandonCurrentSegment('session_error')
        this.listener?.({ type: 'reconnecting', reason })
      },

      onClose: () => {
        if (!ref.active || this.closed) return
        ref.active = false
        this.sessionReady = false
        this.session = null
        log('RECONNECT — session closed unexpectedly', { segId: this.currentSegId || '(none)' })
        this.abandonCurrentSegment('ws_closed')
        this.listener?.({ type: 'reconnecting', reason: 'ws_closed' })
      },
    })

    this.session.connect()
  }

  /** Legacy blob path — no-op in streaming mode. Kept for interface compatibility. */
  async pushChunk(_blob: Blob, _mime: string): Promise<void> {
    // Audio arrives via pushPcm; blob slices are disabled in streaming mode.
  }
}
