/**
 * YoumiLiveAdapter — DashScope Paraformer, "continuity-first" architecture.
 *
 * Core principles (this redesign):
 *   1. 不漏句 — Content is committed within 3s max, even if DashScope stalls.
 *   2. 不断流 — Session stays open; no per-sentence rotate.
 *   3. 少主动切段 — Force-flush only at 60s (absolute last resort).
 *   4. 少依赖 final — Stall-commit lets content advance without waiting for DashScope VAD.
 *   5. 防止错位 — Delta-emit handles DashScope late finals that overlap committed content.
 *
 * Segment lifecycle with DashScope:
 *   - First interim → create stream-N.
 *   - Each interim → update gray draft for stream-N.
 *   - Natural DashScope final → commit stream-N to black text, move to stream-N+1.
 *   - If no new interim for STALL_COMMIT_AFTER_MS → "stall-commit": emit synthetic final
 *     for stream-N with current lastInterimText, keep session open, move to stream-N+1.
 *   - If DashScope's natural final arrives after a stall-commit ("late final"):
 *     → compare with already-committed text, emit only the delta if significant.
 *   - Force-flush (60s, last resort): emit synthetic final + rotate session.
 *
 * Audio flow:
 *   browser AudioContext (PCM Int16) → pushPcm() → StreamingWsSession → server WS
 *   → DashScope Paraformer realtime-v2 → stream_interim / stream_final → adapter events
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

// Energy threshold for speech-onset detection (Int16 range ±32767).
const VOICE_ENERGY_THRESHOLD = 500

// Target cadence window for visible draft updates (ms).
// Upper bound: if content is available but not yet shown, fire within this window.
// Lower bound: hold back updates that arrive faster than this to prevent flicker.
const CADENCE_MIN_MS = 250   // never update faster than this — prevents text jitter
const CADENCE_MAX_MS = 350   // always update within this window when content is pending

// PCM queue capacity: DashScope pre-warm takes 3-6s from Railway to China.
// 150 frames at ~46ms each ≈ 7s — enough for cold start or pool miss.
const PCM_QUEUE_CAP = 150

// STALL_COMMIT_AFTER_MS: if no new interim arrives for this long, emit what we have
// as a synthetic final (session stays open). Prevents content loss on DashScope stalls.
// Set above the observed worst-case stall (1.5-2s) to avoid premature commits.
const STALL_COMMIT_AFTER_MS = 3_000

// Log stalls at 1.5s (diagnostic) but only commit at 3s.
const STALL_LOG_THRESHOLD_MS = 1_500

// FORCE_FLUSH_AFTER_MS: last-resort session rotation after this long without any
// natural DashScope final. Only fires for genuinely marathon non-stop speech.
// Every rotation risks a brief content gap — keep this large.
const FORCE_FLUSH_AFTER_MS = 60_000

// Minimum delta length to emit from a late DashScope natural final.
// Below this threshold, the late final adds noise without meaningful content.
const MIN_DELTA_LENGTH = 5

// ── CadenceScheduler ──────────────────────────────────────────────────────────
//
// Controls the visible update cadence of `en_interim` events delivered to App.tsx.
//
// Problem: DashScope may send interims every 100-500ms (irregular); showing every
// single one causes either text jitter (too fast) or 1s+ jumps (too slow).
//
// Solution: a "min-delay + max-delay" scheduler.
//   • When an interim arrives and enough time has passed (≥ CADENCE_MIN_MS):
//     emit immediately — no artificial hold.
//   • When an interim arrives too soon after the last emit (< CADENCE_MIN_MS):
//     arm a timer to emit at exactly CADENCE_MIN_MS from the last emit.
//     Any additional interims that arrive before the timer fires are coalesced
//     (only the latest text is emitted when the timer fires).
//   • An independent "max-delay" timer ensures that if content is pending but
//     the min-delay timer somehow overshoots, we fire by CADENCE_MAX_MS.
//
// Result: when interims flow continuously, the user sees text updates every
// 250-350ms — smooth, stable, no jumps, no flicker.
//
class CadenceScheduler {
  private pending: { segId: string; rev: number; text: string } | null = null
  private lastEmitMs = 0
  private minTimer: ReturnType<typeof setTimeout> | null = null
  private maxTimer: ReturnType<typeof setTimeout> | null = null
  private readonly onEmit: (segId: string, rev: number, text: string) => void

  constructor(onEmit: (segId: string, rev: number, text: string) => void) {
    this.onEmit = onEmit
  }

  schedule(segId: string, rev: number, text: string) {
    this.pending = { segId, rev, text }

    if (this.minTimer !== null) {
      // A min-delay timer is already running — it will pick up the latest pending on fire.
      // The max-delay timer is also already running, so we're covered.
      return
    }

    const now = Date.now()
    const sinceLastEmit = now - this.lastEmitMs

    if (sinceLastEmit >= CADENCE_MIN_MS) {
      // Enough time since last emit — show immediately (synchronous, no timer overhead).
      this.flush(now)
    } else {
      // Too soon — schedule at CADENCE_MIN_MS from last emit.
      const minDelay = CADENCE_MIN_MS - sinceLastEmit
      this.minTimer = setTimeout(() => {
        this.minTimer = null
        this.clearMaxTimer()
        this.flush(Date.now())
      }, minDelay)

      // Safety: if the min-delay timer overshoots, force-fire at CADENCE_MAX_MS.
      // (minDelay + overshoot headroom = CADENCE_MAX_MS - sinceLastEmit)
      const maxDelay = CADENCE_MAX_MS - sinceLastEmit
      this.maxTimer = setTimeout(() => {
        this.maxTimer = null
        if (this.minTimer !== null) {
          clearTimeout(this.minTimer)
          this.minTimer = null
        }
        this.flush(Date.now())
      }, maxDelay)
    }
  }

  private flush(now: number) {
    const p = this.pending
    if (!p) return
    this.pending = null
    const gapMs = this.lastEmitMs ? now - this.lastEmitMs : -1
    this.lastEmitMs = now
    console.info('[Cadence] en_interim → UI', {
      segId: p.segId,
      rev: p.rev,
      gapMs,
      textLen: p.text.length,
      preview: p.text.slice(0, 40),
    })
    this.onEmit(p.segId, p.rev, p.text)
  }

  private clearMaxTimer() {
    if (this.maxTimer !== null) {
      clearTimeout(this.maxTimer)
      this.maxTimer = null
    }
  }

  /** Cancel any pending update (e.g., when a final arrives and supersedes the draft). */
  cancel() {
    if (this.minTimer !== null) { clearTimeout(this.minTimer); this.minTimer = null }
    this.clearMaxTimer()
    this.pending = null
    // lastEmitMs intentionally preserved — cadence continues across segment boundaries.
  }

  /** Full reset: cancel pending + reset timing (call at start of new recording session). */
  reset() {
    this.cancel()
    this.lastEmitMs = 0
  }
}

export class YoumiLiveAdapter {
  private listener: YoumiAdapterListener | null = null
  private closed = false
  private session: StreamingWsSession | null = null
  private sessionReady = false
  private lastSampleRate = 0
  private activeRef: { active: boolean } = { active: false }

  // Per-segment tracking
  private currentSegId = ''
  private segCounter = 0
  private interimRev = 0
  private lastInterimMs = 0
  private lastInterimText = ''

  // Continuity-first state
  // lastStaleCommittedText: the text we committed via stall-commit (synthetic final).
  // When DashScope's late natural final arrives, we compare against this to emit only
  // the delta (extra words DashScope buffered that we hadn't seen as interim).
  private lastStaleCommittedText = ''
  private stallCommitTimer: ReturnType<typeof setTimeout> | null = null
  private forceFlusher: ReturnType<typeof setTimeout> | null = null

  // Diagnostic instrumentation
  private speechOnsetMs = 0
  private firstInterimLogged = false
  private lastFinalMs = 0
  private pcmQueue: ArrayBuffer[] = []
  private pcmQueueHighWater = 0
  private stallCheckTimer: ReturnType<typeof setInterval> | null = null

  // Cadence scheduler: controls visible en_interim update rhythm (250-350ms window).
  private readonly cadence = new CadenceScheduler((segId, rev, text) => {
    this.listener?.({ type: 'en_interim', segmentId: segId, rev, text })
  })

  onEvent(listener: YoumiAdapterListener) {
    this.listener = listener
  }

  start() {
    this.closed = false
    this.sessionReady = false
    this.activeRef = { active: false }
    this.currentSegId = ''
    this.segCounter = 0
    this.interimRev = 0
    this.lastInterimMs = 0
    this.lastInterimText = ''
    this.lastStaleCommittedText = ''
    this.pcmQueue = []
    this.speechOnsetMs = 0
    this.firstInterimLogged = false
    this.lastFinalMs = 0
    this.pcmQueueHighWater = 0
    this.cadence.reset()
    log('adapter starting (DashScope continuity-first mode)')
    this.listener?.({ type: 'connected' })
  }

  stop() {
    this.closed = true
    this.cadence.cancel()
    this.clearStallCommit()
    this.clearForceFlusher()
    this.clearStallDetector()
    this.activeRef.active = false
    log('adapter stop')
    this.session?.stop()
    setTimeout(() => {
      this.session?.destroy()
      this.session = null
    }, 500)
    this.listener?.({ type: 'closed' })
  }

  // ── Stall commit ──────────────────────────────────────────────────────────
  // Arms after each new interim. If no new interim arrives within STALL_COMMIT_AFTER_MS,
  // commits current content as a synthetic final WITHOUT rotating the session.

  private armStallCommit() {
    this.clearStallCommit()
    this.stallCommitTimer = setTimeout(() => {
      this.stallCommitTimer = null
      const text = this.lastInterimText
      const segId = this.currentSegId
      if (!text || !segId || this.closed) return

      log('CONTINUITY stall-commit — emitting synthetic final, session stays open', {
        segId,
        textLen: text.length,
        stalledMs: this.lastInterimMs ? Date.now() - this.lastInterimMs : -1,
        preview: text.slice(0, 60),
      })

      // Remember what we committed so we can handle DashScope's late natural final.
      this.lastStaleCommittedText = text

      // Commit content and advance segment state. Session does NOT rotate.
      this.clearStallDetector()
      this.currentSegId = ''
      this.interimRev = 0
      this.lastInterimText = ''
      this.lastInterimMs = 0
      this.firstInterimLogged = false
      this.speechOnsetMs = 0
      this.lastFinalMs = Date.now()

      this.listener?.({ type: 'connected' })
      this.listener?.({ type: 'en_final', segmentId: segId, text })
    }, STALL_COMMIT_AFTER_MS)
  }

  private clearStallCommit() {
    if (this.stallCommitTimer) {
      clearTimeout(this.stallCommitTimer)
      this.stallCommitTimer = null
    }
  }

  // ── Force-flush (last resort, 60s) ────────────────────────────────────────
  // Armed on session init, reset on each natural DashScope final.
  // Only fires for truly marathon speech with no natural pause for 60s.

  private armForceFlusher() {
    this.clearForceFlusher()
    this.forceFlusher = setTimeout(() => {
      this.forceFlusher = null
      if (this.closed || !this.sessionReady) return

      const text = this.lastInterimText
      const segId = this.currentSegId
      log('FORCE-FLUSH 60s — rotating session (last resort)', {
        segId: segId || '(none)',
        textLen: text.length,
      })

      // Commit any in-progress content before rotating.
      this.clearStallCommit()
      this.clearStallDetector()
      if (segId && text) {
        this.lastStaleCommittedText = text
        this.currentSegId = ''
        this.interimRev = 0
        this.lastInterimText = ''
        this.lastInterimMs = 0
        this.lastFinalMs = Date.now()
        this.listener?.({ type: 'en_final', segmentId: segId, text })
      }

      // Rotate session: start new immediately, stop old in background.
      const oldRef = this.activeRef
      const oldSession = this.session
      oldRef.active = false
      this.sessionReady = false
      this.session = null
      setTimeout(() => { oldSession?.stop(); setTimeout(() => oldSession?.destroy(), 1000) }, 0)

      if (this.lastSampleRate > 0) this.initSession(this.lastSampleRate)
    }, FORCE_FLUSH_AFTER_MS)
  }

  private clearForceFlusher() {
    if (this.forceFlusher) {
      clearTimeout(this.forceFlusher)
      this.forceFlusher = null
    }
  }

  // ── Stall detector (diagnostic logging only) ──────────────────────────────

  private startStallDetector(segId: string) {
    this.clearStallDetector()
    this.stallCheckTimer = setInterval(() => {
      if (!this.currentSegId) { this.clearStallDetector(); return }
      if (!this.lastInterimMs) return
      const stalledMs = Date.now() - this.lastInterimMs
      if (stalledMs >= STALL_LOG_THRESHOLD_MS) {
        log('STALL mid-sentence — no interim received', {
          segId: this.currentSegId || segId,
          stalledMs,
          sessionReady: this.sessionReady,
          pcmQueued: this.pcmQueue.length,
          stallCommitFiringInMs: STALL_COMMIT_AFTER_MS - stalledMs,
        })
      }
    }, 500)
  }

  private clearStallDetector() {
    if (this.stallCheckTimer) {
      clearInterval(this.stallCheckTimer)
      this.stallCheckTimer = null
    }
  }

  // ── Reconnect helper ──────────────────────────────────────────────────────

  private abandonCurrentSegment(reason: string) {
    this.cadence.cancel()
    this.clearStallCommit()
    this.clearForceFlusher()
    this.clearStallDetector()
    const segId = this.currentSegId
    const text = this.lastInterimText
    this.currentSegId = ''
    this.interimRev = 0
    this.lastInterimText = ''
    this.lastInterimMs = 0
    this.firstInterimLogged = false
    this.speechOnsetMs = 0
    if (segId) {
      log('synthetic final for abandoned segment', {
        reason, segId, textLen: text.length,
        nextSegWillBe: `stream-${this.segCounter}`,
      })
      this.listener?.({ type: 'en_final', segmentId: segId, text })
    }
  }

  // ── Audio input ───────────────────────────────────────────────────────────

  pushPcm(buffer: ArrayBuffer, sampleRate: number) {
    if (this.closed) return
    this.lastSampleRate = sampleRate

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
      if (this.pcmQueue.length > PCM_QUEUE_CAP) {
        this.pcmQueue.shift()  // drop oldest, keep newest
      }
      if (this.pcmQueue.length > this.pcmQueueHighWater) {
        this.pcmQueueHighWater = this.pcmQueue.length
      }
    }
  }

  // ── Session lifecycle ─────────────────────────────────────────────────────

  private initSession(sampleRate: number) {
    this.lastSampleRate = sampleRate
    const ref = { active: true }
    this.activeRef = ref
    const T_init = Date.now()
    log('init streaming session (DashScope)', { sampleRate, nextSeg: `stream-${this.segCounter}` })

    this.session = new StreamingWsSession(sampleRate, {
      onOpen: () => {
        if (!ref.active || this.closed) return
        log('ws open — waiting for DashScope stream_ready', {
          queued: this.pcmQueue.length,
          wsOpenMs: Date.now() - T_init,
        })
      },

      onReady: () => {
        if (!ref.active || this.closed) return
        this.sessionReady = true
        log('stream_ready (DashScope) — draining PCM queue', {
          queued: this.pcmQueue.length,
          highWater: this.pcmQueueHighWater,
          readyMs: Date.now() - T_init,
          nextSeg: `stream-${this.segCounter}`,
        })
        this.pcmQueueHighWater = 0
        // Arm force-flusher once per session: fires only if 60s pass without any natural final.
        this.armForceFlusher()
        this.listener?.({ type: 'connected' })
        for (const buf of this.pcmQueue) this.session?.sendPcm(buf)
        this.pcmQueue = []
      },

      onInterim: (text) => {
        if (!ref.active || this.closed || !text.trim()) return
        const now = Date.now()
        const trimmed = text.trim()

        const isFirstInterim = !this.currentSegId
        if (isFirstInterim) {
          this.currentSegId = `stream-${this.segCounter++}`
          this.interimRev = 0
          if (this.speechOnsetMs && !this.firstInterimLogged) {
            this.firstInterimLogged = true
            log('A-metric: speech-onset→first-interim', {
              onsetToFirstInterimMs: now - this.speechOnsetMs,
              segId: this.currentSegId,
            })
          }
          if (this.lastFinalMs) {
            log('gap: last-final→first-interim', {
              gapMs: now - this.lastFinalMs,
              segId: this.currentSegId,
            })
          }
          log('new segment', {
            segId: this.currentSegId,
            firstWords: trimmed.slice(0, 60),
            sinceSessionInitMs: now - T_init,
          })
          this.startStallDetector(this.currentSegId)
        } else {
          const gapMs = this.lastInterimMs ? now - this.lastInterimMs : 0
          if (gapMs >= STALL_LOG_THRESHOLD_MS) {
            log('STALL ended — interim resumed', {
              segId: this.currentSegId,
              stalledMs: gapMs,
            })
          }
        }

        this.lastInterimMs = now
        this.lastInterimText = trimmed

        // CONTINUITY: re-arm stall-commit timer on every new interim.
        // If DashScope goes silent for 3s, this fires and commits what we have.
        this.armStallCommit()

        const rev = ++this.interimRev
        log('en_interim', {
          segId: this.currentSegId,
          rev,
          len: trimmed.length,
          preview: trimmed.slice(0, 60),
        })
        // Route through cadence scheduler — limits visible updates to 250-350ms cadence.
        // Multiple interims arriving within the window are coalesced; only latest is shown.
        this.cadence.schedule(this.currentSegId, rev, trimmed)
      },

      onFinal: (text) => {
        if (!ref.active || this.closed || !text.trim()) return
        const now = Date.now()
        const trimmed = text.trim()

        // Cancel stall-commit and any pending cadenced interim (final supersedes draft).
        this.cadence.cancel()
        this.clearStallCommit()
        this.clearStallDetector()

        // ── CONTINUITY: handle late DashScope natural final after a stall-commit ──
        // Pattern: DashScope was stalled > 3s, we committed via stall-commit, then
        // DashScope's own VAD fires its natural final for the same segment.
        // The natural final may contain more content (tail words we never saw as interim).
        // Strategy: emit only the delta (words BEYOND what was stall-committed).
        if (this.lastStaleCommittedText) {
          const stale = this.lastStaleCommittedText
          this.lastStaleCommittedText = ''

          if (trimmed.startsWith(stale)) {
            // Natural final is a superset of stale commit → extract delta.
            const delta = trimmed.slice(stale.length).trim()
            if (delta.length >= MIN_DELTA_LENGTH) {
              const deltaSegId = `stream-${this.segCounter++}`
              log('CONTINUITY late-final delta — new tail content after stall-commit', {
                staleLen: stale.length,
                totalLen: trimmed.length,
                deltaLen: delta.length,
                deltaPreview: delta.slice(0, 60),
              })
              this.lastFinalMs = now
              // Re-arm force-flusher: we got a natural final, reset the 60s window.
              this.armForceFlusher()
              this.listener?.({ type: 'connected' })
              this.listener?.({ type: 'en_final', segmentId: deltaSegId, text: delta })
            } else {
              log('CONTINUITY late-final — delta too small, skipping', {
                staleLen: stale.length, totalLen: trimmed.length, delta,
              })
            }
            return
          }

          // Natural final text diverged from stale interim (DashScope ASR corrected itself).
          // Treat as a fresh final — log the divergence for visibility.
          log('CONTINUITY late-final diverged — treating as fresh final', {
            stale: stale.slice(0, 40),
            actual: trimmed.slice(0, 40),
          })
          // Fall through to normal final handling below.
        }

        // ── Normal DashScope VAD final ────────────────────────────────────────
        // Re-arm force-flusher: natural final received, reset the 60s window.
        this.armForceFlusher()

        const segId = this.currentSegId || `stream-${this.segCounter++}`
        log('B-metric: last-interim→final', {
          lastInterimToFinalMs: this.lastInterimMs ? now - this.lastInterimMs : -1,
          gapSinceLastFinalMs: this.lastFinalMs ? now - this.lastFinalMs : -1,
          segId,
        })
        log('en_final', {
          segId,
          len: trimmed.length,
          sinceSessionInitMs: now - T_init,
          preview: trimmed.slice(0, 80),
        })

        this.currentSegId = ''
        this.interimRev = 0
        this.lastInterimText = ''
        this.lastInterimMs = 0
        this.firstInterimLogged = false
        this.speechOnsetMs = 0
        this.lastFinalMs = now

        this.listener?.({ type: 'connected' })
        this.listener?.({ type: 'en_final', segmentId: segId, text: trimmed })
        log('segment closed — DashScope session alive, waiting for next speech', {
          nextSeg: `stream-${this.segCounter}`,
        })
      },

      onError: (reason) => {
        if (!ref.active || this.closed) return
        log('RECONNECT triggered — session error', {
          reason,
          segId: this.currentSegId || '(none)',
          pcmQueued: this.pcmQueue.length,
        })
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
        log('RECONNECT triggered — session closed unexpectedly', {
          segId: this.currentSegId || '(none)',
          pcmQueued: this.pcmQueue.length,
        })
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
