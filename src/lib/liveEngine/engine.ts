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

export class LiveEngine {
  private listener: LiveEngineListener | null = null
  private adapter: YoumiLiveAdapter | null = null
  private running = false
  private translateTarget: 'zh' | 'en' | 'off' = 'off'
  private zhRevBySeg = new Map<string, number>()

  onEvent(listener: LiveEngineListener) {
    this.listener = listener
  }

  start(opts: StartOptions) {
    if (this.running) this.stop()
    this.running = true
    this.translateTarget = opts.translateTarget
    this.zhRevBySeg.clear()
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
        log('en_interim', { segmentId: ev.segmentId, rev: ev.rev, len: ev.text.length })
        this.emit({ type: 'status', status: 'streaming' })
        this.emit({ type: 'en_interim', segmentId: ev.segmentId, rev: ev.rev, text: ev.text })
        void this.translateInterim(ev.segmentId, ev.text)
        return
      }
      if (ev.type === 'en_final') {
        log('en_final', { segmentId: ev.segmentId, len: ev.text.length })
        this.emit({ type: 'en_final', segmentId: ev.segmentId, text: ev.text })
        void this.translateFinal(ev.segmentId, ev.text)
      }
    })
    adapter.start()
  }

  stop() {
    if (!this.running) return
    this.running = false
    this.adapter?.stop()
    this.adapter = null
    this.emit({ type: 'status', status: 'closed' })
    log('stop')
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

  private async translateFinal(segmentId: string, text: string) {
    if (this.translateTarget === 'off') return
    const t = text.trim()
    if (!t) return
    try {
      const zh = (await translateLiveCaption(t, { target: this.translateTarget })).trim()
      if (!zh || !this.running) return
      log('zh_final', { segmentId, len: zh.length })
      this.emit({ type: 'zh_final', segmentId, text: zh })
    } catch (e) {
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

