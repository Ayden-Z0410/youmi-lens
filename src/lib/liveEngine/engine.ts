import { translateLiveCaption } from '../aiClient'
import { YoumiLiveAdapter } from './adapters/youmiAdapter'
import type { LiveEngineEvent, LiveEngineListener } from './types'

type StartOptions = {
  translateTarget: 'zh' | 'en' | 'off'
}

function log(tag: string, fields?: Record<string, unknown>) {
  if (fields) console.info(`[LiveEngine] ${tag}`, JSON.stringify(fields))
  else console.info(`[LiveEngine] ${tag}`)
}

// ─── Translation queue ────────────────────────────────────────────────────────
// translateFinal is fire-and-forget. Without rate-limiting, a slow Qwen API can
// cause 10+ concurrent fetches after 20+ minutes, degrading the event loop.
// Cap at MAX_CONCURRENT translations; silently drop oldest when backlog exceeds
// MAX_QUEUE_SIZE so the queue never grows unboundedly during a long lecture.
const MAX_CONCURRENT_TRANSLATIONS = 2
const MAX_QUEUE_SIZE = 5

export class LiveEngine {
  private listener: LiveEngineListener | null = null
  private adapter: YoumiLiveAdapter | null = null
  private running = false
  private translateTarget: 'zh' | 'en' | 'off' = 'off'
  private zhRevBySeg = new Map<string, number>()

  // Debounce interim translation: latest interim only, keep secondary line snappy without spamming API.
  private interimTranslateTimer: ReturnType<typeof setTimeout> | null = null
  private static readonly INTERIM_TRANSLATE_DEBOUNCE_MS = 220

  // Translation queue state
  private translationQueue: Array<{ segmentId: string; text: string; enqueuedAt: number }> = []
  private activeTranslations = 0

  // Session-level timing for long-run diagnostics: ms since engine.start()
  private sessionStartMs = 0

  private elapsed(): number {
    return this.sessionStartMs ? Date.now() - this.sessionStartMs : 0
  }

  onEvent(listener: LiveEngineListener) {
    this.listener = listener
  }

  start(opts: StartOptions) {
    if (this.running) this.stop()
    this.running = true
    this.translateTarget = opts.translateTarget
    this.zhRevBySeg.clear()
    this.translationQueue = []
    this.activeTranslations = 0
    this.sessionStartMs = Date.now()
    log('start')
    this.emit({ type: 'status', status: 'starting' })
    const adapter = new YoumiLiveAdapter()
    this.adapter = adapter
    adapter.onEvent((ev) => {
      if (!this.running) return
      if (ev.type === 'connected') {
        log('adapter connected')
        this.emit({ type: 'status', status: 'connected' })
        return
      }
      if (ev.type === 'reconnecting') {
        log('adapter reconnecting', { reason: ev.reason })
        this.emit({ type: 'status', status: 'reconnecting', detail: ev.reason })
        return
      }
      if (ev.type === 'closed') {
        log('adapter closed')
        this.emit({ type: 'status', status: 'closed' })
        return
      }
      if (ev.type === 'error') {
        log('error', { code: ev.code, message: ev.message })
        this.emit({ type: 'error', code: ev.code, message: ev.message, recoverable: ev.recoverable })
        return
      }
      if (ev.type === 'en_interim') {
        log('en_interim', { segmentId: ev.segmentId, rev: ev.rev, len: ev.text.length, sessionMs: this.elapsed() })
        this.emit({ type: 'status', status: 'streaming' })
        this.emit({ type: 'en_interim', segmentId: ev.segmentId, rev: ev.rev, text: ev.text })
        // Cancel any pending interim debounce — prevents stale zh_interim after zh_final
        if (this.interimTranslateTimer) {
          clearTimeout(this.interimTranslateTimer)
          this.interimTranslateTimer = null
        }
        const capturedId = ev.segmentId
        const capturedText = ev.text
        this.interimTranslateTimer = setTimeout(() => {
          this.interimTranslateTimer = null
          void this.translateInterim(capturedId, capturedText)
        }, LiveEngine.INTERIM_TRANSLATE_DEBOUNCE_MS)
        return
      }
      if (ev.type === 'en_final') {
        // Cancel any pending interim translation debounce before processing the final
        if (this.interimTranslateTimer) {
          clearTimeout(this.interimTranslateTimer)
          this.interimTranslateTimer = null
        }
        log('en_final', {
          segmentId: ev.segmentId,
          len: ev.text.length,
          sessionMs: this.elapsed(),
          translationQueueDepth: this.translationQueue.length,
          activeTranslations: this.activeTranslations,
        })
        this.emit({ type: 'en_final', segmentId: ev.segmentId, text: ev.text })
        this.enqueueTranslation(ev.segmentId, ev.text)
      }
    })
    adapter.start()
  }

  stop() {
    if (!this.running) return
    this.running = false
    if (this.interimTranslateTimer) {
      clearTimeout(this.interimTranslateTimer)
      this.interimTranslateTimer = null
    }
    this.translationQueue = []
    this.adapter?.stop()
    this.adapter = null
    this.emit({ type: 'status', status: 'closed' })
    log('stop', { totalSessionMs: this.elapsed() })
  }

  pushAudioChunk(blob: Blob, mime: string) {
    if (!this.running || !this.adapter) {
      log('pushAudioChunk ignored', {
        running: this.running,
        hasAdapter: Boolean(this.adapter),
        bytes: blob.size,
        mime,
      })
      return
    }
    log('pushAudioChunk', { bytes: blob.size, mime })
    void this.adapter.pushChunk(blob, mime)
  }

  /** Push a raw PCM Int16 frame from AudioContext capture (streaming path). */
  pushPcmChunk(buffer: ArrayBuffer, sampleRate: number) {
    if (!this.running || !this.adapter) return
    this.adapter.pushPcm(buffer, sampleRate)
  }

  // ─── Translation queue management ──────────────────────────────────────────

  private enqueueTranslation(segmentId: string, text: string) {
    if (this.translateTarget === 'off') return
    if (!text.trim()) return

    this.translationQueue.push({ segmentId, text, enqueuedAt: Date.now() })

    // Drop oldest entries when backlogged — prevents unbounded growth during long sessions
    if (this.translationQueue.length > MAX_QUEUE_SIZE) {
      const dropped = this.translationQueue.splice(0, this.translationQueue.length - MAX_QUEUE_SIZE)
      log('translation queue backlog — dropped stale jobs', {
        dropped: dropped.length,
        sessionMs: this.elapsed(),
      })
    }

    this.drainTranslationQueue()
  }

  private drainTranslationQueue() {
    while (
      this.activeTranslations < MAX_CONCURRENT_TRANSLATIONS &&
      this.translationQueue.length > 0
    ) {
      const job = this.translationQueue.shift()!
      const waitMs = Date.now() - job.enqueuedAt
      if (waitMs > 8000) {
        // Discard jobs that sat in queue too long — avoids stale translations appearing after zh_final
        log('translation job expired in queue', { segmentId: job.segmentId, waitMs, sessionMs: this.elapsed() })
        continue
      }
      this.activeTranslations++
      this.translateFinal(job.segmentId, job.text, job.enqueuedAt).finally(() => {
        this.activeTranslations--
        this.drainTranslationQueue()
      })
    }
  }

  private async translateInterim(segmentId: string, text: string) {
    if (this.translateTarget === 'off') return
    const t = text.trim()
    if (!t) return
    try {
      const zh = (await translateLiveCaption(t, { target: this.translateTarget })).trim()
      if (!zh || !this.running) return
      const rev = (this.zhRevBySeg.get(segmentId) ?? 0) + 1
      this.zhRevBySeg.set(segmentId, rev)
      log('zh_interim', { segmentId, rev, len: zh.length })
      this.emit({ type: 'zh_interim', segmentId, rev, text: zh })
    } catch (e) {
      this.emit({
        type: 'error',
        code: 'zh_interim_failed',
        message: e instanceof Error ? e.message : String(e),
        recoverable: true,
      })
    }
  }

  private async translateFinal(segmentId: string, text: string, enqueuedAt?: number) {
    if (this.translateTarget === 'off') return
    const t = text.trim()
    if (!t) return
    const t0 = Date.now()
    try {
      const zh = (await translateLiveCaption(t, { target: this.translateTarget })).trim()
      const latencyMs = Date.now() - t0
      const queueWaitMs = enqueuedAt ? t0 - enqueuedAt : 0
      // Timing log: visible in Console over time to spot Qwen API degradation
      log('zh_final', { segmentId, len: zh.length, latencyMs, queueWaitMs, sessionMs: this.elapsed() })
      if (!zh || !this.running) return
      this.emit({ type: 'zh_final', segmentId, text: zh })
    } catch (e) {
      log('zh_final_failed', { segmentId, ms: Date.now() - t0, sessionMs: this.elapsed() })
      this.emit({
        type: 'error',
        code: 'zh_final_failed',
        message: e instanceof Error ? e.message : String(e),
        recoverable: true,
      })
    }
  }

  private emit(ev: LiveEngineEvent) {
    this.listener?.(ev)
  }
}
