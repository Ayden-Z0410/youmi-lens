import { transcribeHostedLiveRealtime } from '../../liveCaptionRealtime'

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

export class YoumiLiveAdapter {
  private listener: YoumiAdapterListener | null = null
  private closed = false
  private seq = 0

  onEvent(listener: YoumiAdapterListener) {
    this.listener = listener
  }

  start() {
    this.closed = false
    log('adapter connected')
    this.listener?.({ type: 'connected' })
  }

  stop() {
    this.closed = true
    log('adapter closed')
    this.listener?.({ type: 'closed' })
  }

  async pushChunk(blob: Blob, mime: string) {
    if (this.closed) return
    const segIndex = this.seq++
    const id = `seg-${segIndex}`
    // Earlier, shorter draft for first segments; slightly smaller steps afterward (UX tuning only).
    const ratio = segIndex <= 1 ? 0.32 : 0.42
    const floor = segIndex <= 1 ? 2800 : 4000
    const draftSliceBytes = Math.min(blob.size, Math.max(floor, Math.floor(blob.size * ratio)))
    const draftBlob = blob.slice(0, draftSliceBytes, mime)
    log('send frame', {
      segmentId: id,
      bytes: blob.size,
      draftBytes: draftBlob.size,
      mime,
    })

    try {
      const draft = (await transcribeHostedLiveRealtime(draftBlob, mime, 'draft')).trim()
      log('recv message', {
        segmentId: id,
        pass: 'draft',
        textLen: draft.length,
      })
      if (draft && !this.closed) {
        this.listener?.({ type: 'en_interim', segmentId: id, rev: 1, text: draft })
      }
    } catch (e) {
      log('adapter reconnecting', { reason: e instanceof Error ? e.message : String(e) })
      this.listener?.({
        type: 'reconnecting',
        reason: e instanceof Error ? e.message : String(e),
      })
    }

    try {
      const fin = (await transcribeHostedLiveRealtime(blob, mime, 'final')).trim()
      log('recv message', {
        segmentId: id,
        pass: 'final',
        textLen: fin.length,
      })
      if (this.closed) return
      this.listener?.({ type: 'connected' })
      if (fin) {
        this.listener?.({ type: 'en_final', segmentId: id, text: fin })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.listener?.({
        type: 'error',
        code: 'youmi_final_failed',
        message: msg,
        recoverable: true,
      })
    }
  }
}

