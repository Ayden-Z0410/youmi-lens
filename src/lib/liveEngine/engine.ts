/**
 * LiveEngine — consumes **streaming ASR text** from `YoumiLiveAdapter` (`en_interim` / `en_final`), then
 * **translation-from-text** via HTTP. Post-class transcription/summary stay out of this module.
 */
import { translateLiveCaption } from '../aiClient'
import { deOverlapEnglish } from '../liveCaptionDeOverlap'
import {
  normalizeEnglishPrimaryPayloadOrReject,
  normalizeZhPayloadOrReject,
  sanitizeEnglishForZhTranslate,
} from '../liveCaptionSanitize'
import { traceDeOverlap, traceEnFinal, traceEnInterim, traceReset } from '../liveCaptionTrace'
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
  /** Monotonic per segmentId so stale translateFinal completions are dropped when a newer final supersedes. */
  private translateRevBySeg = new Map<string, number>()
  /**
   * Bumped on each en_final for a segment so in-flight translateInterim HTTP completions
   * (same segment, older EN draft) never emit zh_interim after the segment has finalized.
   */
  private zhInterimGenBySeg = new Map<string, number>()
  /** Latest EN interim text per segment (timer reads this, not a stale closure). */
  private latestEnInterimBySeg = new Map<string, string>()
  /** Last EN source we actually translated for zh_interim (phrase-aligned; avoids micro-retranslate). */
  private lastZhInterimChunkEnBySeg = new Map<string, string>()
  private lastZhInterimChunkAtMsBySeg = new Map<string, number>()

  /** Monotonic: only grows via appending de-overlapped novelText from en_final events. */
  private committedEnFull = ''

  // Debounce interim translation: latest interim only, keep secondary line snappy without spamming API.
  private interimTranslateTimer: ReturnType<typeof setTimeout> | null = null
  /** Debounced so zh_interim tracks phrase-level EN, not every ASR partial. */
  private static readonly INTERIM_TRANSLATE_DEBOUNCE_MS = 300

  // Translation queue state
  private translationQueue: Array<{ segmentId: string; text: string; enqueuedAt: number; rev: number }> =
    []
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
    this.translateRevBySeg.clear()
    this.zhInterimGenBySeg.clear()
    this.latestEnInterimBySeg.clear()
    this.lastZhInterimChunkEnBySeg.clear()
    this.lastZhInterimChunkAtMsBySeg.clear()
    this.committedEnFull = ''
    this.translationQueue = []
    this.activeTranslations = 0
    this.sessionStartMs = Date.now()
    traceReset()
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
        const clean = normalizeEnglishPrimaryPayloadOrReject(ev.text)
        if (!clean) return
        traceEnInterim(ev.segmentId, ev.rev, clean)
        const prev = this.latestEnInterimBySeg.get(ev.segmentId) ?? ''
        if (clean === prev) return
        this.latestEnInterimBySeg.set(ev.segmentId, clean)

        const deo = deOverlapEnglish(this.committedEnFull, clean)
        traceDeOverlap('en_interim', ev.segmentId, clean.length, deo)
        this.emit({ type: 'en_interim', segmentId: ev.segmentId, rev: ev.rev, text: deo.novelText })

        if (this.interimTranslateTimer) {
          clearTimeout(this.interimTranslateTimer)
          this.interimTranslateTimer = null
        }
        const capturedId = ev.segmentId
        const gen = this.zhInterimGenBySeg.get(capturedId) ?? 0
        this.interimTranslateTimer = setTimeout(() => {
          this.interimTranslateTimer = null
          const rawLatest = this.latestEnInterimBySeg.get(capturedId) ?? ''
          if (!rawLatest) return
          const latestDeo = deOverlapEnglish(this.committedEnFull, rawLatest)
          if (!latestDeo.novelText.trim()) return
          void this.translateInterim(capturedId, latestDeo.novelText, gen)
        }, LiveEngine.INTERIM_TRANSLATE_DEBOUNCE_MS)
        return
      }
      if (ev.type === 'en_final') {
        if (this.interimTranslateTimer) {
          clearTimeout(this.interimTranslateTimer)
          this.interimTranslateTimer = null
        }
        const sid = ev.segmentId
        this.zhInterimGenBySeg.set(sid, (this.zhInterimGenBySeg.get(sid) ?? 0) + 1)
        this.lastZhInterimChunkEnBySeg.delete(sid)
        this.lastZhInterimChunkAtMsBySeg.delete(sid)
        const cleanFinal = normalizeEnglishPrimaryPayloadOrReject(ev.text)
        if (!cleanFinal) return
        traceEnFinal(ev.segmentId, cleanFinal)

        const deo = deOverlapEnglish(this.committedEnFull, cleanFinal)
        traceDeOverlap('en_final', ev.segmentId, cleanFinal.length, deo)

        if (!deo.novelText.trim()) {
          log('en_final skipped (no novel text)', {
            segmentId: ev.segmentId,
            incomingLen: cleanFinal.length,
            overlapTokens: deo.overlapTokenCount,
            sessionMs: this.elapsed(),
          })
          return
        }

        this.committedEnFull += (this.committedEnFull ? ' ' : '') + deo.novelText
        log('en_final', {
          segmentId: ev.segmentId,
          novelLen: deo.novelText.length,
          committedLen: this.committedEnFull.length,
          overlapTokens: deo.overlapTokenCount,
          sessionMs: this.elapsed(),
          translationQueueDepth: this.translationQueue.length,
          activeTranslations: this.activeTranslations,
        })
        this.emit({ type: 'en_final', segmentId: ev.segmentId, text: deo.novelText })
        this.enqueueTranslation(ev.segmentId, deo.novelText)
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

    const rev = (this.translateRevBySeg.get(segmentId) ?? 0) + 1
    this.translateRevBySeg.set(segmentId, rev)
    this.translationQueue = this.translationQueue.filter((j) => j.segmentId !== segmentId)

    this.translationQueue.push({ segmentId, text, enqueuedAt: Date.now(), rev })

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
      this.translateFinal(job.segmentId, job.text, job.enqueuedAt, job.rev).finally(() => {
        this.activeTranslations--
        this.drainTranslationQueue()
      })
    }
  }

  /** Only translate when EN moved enough for a phrase chunk (aligned with App phrase display). */
  private shouldEmitZhInterimForChunk(segmentId: string, en: string): boolean {
    const last = this.lastZhInterimChunkEnBySeg.get(segmentId) ?? ''
    if (en === last) return false
    const trim = en.trimEnd()
    const endsClause = /[.!?,;:\u2026]\s*$/.test(trim)
    if (endsClause) return true
    if (last.length === 0) {
      return en.trim().length >= 6 || endsClause
    }
    if (en.length - last.length >= 14) return true
    const now = Date.now()
    const prevAt = this.lastZhInterimChunkAtMsBySeg.get(segmentId) ?? 0
    if (now - prevAt >= 520 && en.length > last.length + 4) return true
    return false
  }

  private async translateInterim(segmentId: string, text: string, expectedGen: number) {
    if (this.translateTarget === 'off') return
    let t = text.trim()
    if (!t) return
    if (this.translateTarget === 'zh') t = sanitizeEnglishForZhTranslate(t)
    if (!t) return
    if (!this.shouldEmitZhInterimForChunk(segmentId, t)) return
    try {
      const zhRaw = (await translateLiveCaption(t, { target: this.translateTarget })).trim()
      const zh = normalizeZhPayloadOrReject(zhRaw, this.translateTarget)
      if (!zh || !this.running) return
      if ((this.zhInterimGenBySeg.get(segmentId) ?? 0) !== expectedGen) return
      const rev = (this.zhRevBySeg.get(segmentId) ?? 0) + 1
      this.zhRevBySeg.set(segmentId, rev)
      this.lastZhInterimChunkEnBySeg.set(segmentId, t)
      this.lastZhInterimChunkAtMsBySeg.set(segmentId, Date.now())
      log('zh_interim', { segmentId, rev, len: zh.length })
      this.emit({ type: 'zh_interim', segmentId, rev, text: zh, sourceEn: t })
    } catch (e) {
      this.emit({
        type: 'error',
        code: 'zh_interim_failed',
        message: e instanceof Error ? e.message : String(e),
        recoverable: true,
      })
    }
  }

  private async translateFinal(
    segmentId: string,
    text: string,
    enqueuedAt?: number,
    rev?: number,
  ) {
    if (this.translateTarget === 'off') return
    let t = text.trim()
    if (!t) return
    if (this.translateTarget === 'zh') t = sanitizeEnglishForZhTranslate(t)
    if (!t) return
    const t0 = Date.now()
    try {
      const zhRaw = (await translateLiveCaption(t, { target: this.translateTarget })).trim()
      const zh = normalizeZhPayloadOrReject(zhRaw, this.translateTarget)
      const latencyMs = Date.now() - t0
      const queueWaitMs = enqueuedAt ? t0 - enqueuedAt : 0
      if (rev !== undefined) {
        const latest = this.translateRevBySeg.get(segmentId)
        if (latest !== rev) {
          log('zh_final dropped (stale rev)', { segmentId, rev, latest, sessionMs: this.elapsed() })
          return
        }
      }
      // Timing log: visible in Console over time to spot Qwen API degradation
      log('zh_final', { segmentId, len: zh?.length ?? 0, latencyMs, queueWaitMs, sessionMs: this.elapsed() })
      if (!zh || !this.running) return
      this.emit({ type: 'zh_final', segmentId, text: zh, sourceEn: t })
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
