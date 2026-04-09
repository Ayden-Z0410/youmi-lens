import { getAiApiBase } from './ai/apiBase'

type Pending = {
  resolve: (text: string) => void
  reject: (error: Error) => void
}

class LiveCaptionRealtimeClient {
  private ws: WebSocket | null = null
  private pending = new Map<string, Pending>()
  private openPromise: Promise<void> | null = null

  private wsUrl() {
    // Same gateway as HTTP (`getAiApiBase`): remote in Tauri prod, `/api` in dev (resolved to ws(s)://current host).
    const base = getAiApiBase()
    const trimmed = base.replace(/\/$/, '')
    if (/^wss?:\/\//i.test(trimmed)) return `${trimmed}/live-realtime-ws`
    if (/^https?:\/\//i.test(trimmed)) return `${trimmed.replace(/^http/i, 'ws')}/live-realtime-ws`
    // Dev: getAiApiBase() is relative "/api". WebSocket needs absolute ws(s) URL.
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const rel = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
    return `${proto}://${window.location.host}${rel}/live-realtime-ws`
  }

  private async ensureOpen() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return
    if (this.openPromise) return this.openPromise
    this.openPromise = new Promise<void>((resolve, reject) => {
      try {
        const url = this.wsUrl()
        console.info('[LiveEngine][ws] connect', JSON.stringify({ url }))
        const ws = new WebSocket(url)
        this.ws = ws
        ws.onopen = () => resolve()
        ws.onerror = () => reject(new Error('live_ws_connect_failed'))
        ws.onclose = () => {
          console.info('[LiveEngine][ws] closed')
          this.ws = null
          this.openPromise = null
          for (const [, p] of this.pending) p.reject(new Error('live_ws_closed'))
          this.pending.clear()
        }
        ws.onmessage = (ev) => {
          let j: any = null
          try {
            j = JSON.parse(String(ev.data))
          } catch {
            return
          }
          console.info(
            '[LiveEngine][ws] recv',
            JSON.stringify({ type: j?.type ?? null, id: j?.id ?? null, pass: j?.pass ?? null }),
          )
          if (!j || j.type !== 'result' || typeof j.id !== 'string') return
          const p = this.pending.get(j.id)
          if (!p) return
          this.pending.delete(j.id)
          if (j.error) p.reject(new Error(String(j.error)))
          else p.resolve(typeof j.text === 'string' ? j.text : '')
        }
      } catch (e) {
        reject(e instanceof Error ? e : new Error('live_ws_connect_failed'))
      }
    }).finally(() => {
      this.openPromise = null
    })
    return this.openPromise
  }

  async transcribe(blob: Blob, mime: string, pass: 'draft' | 'final'): Promise<string> {
    await this.ensureOpen()
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('live_ws_not_open')
    const id = crypto.randomUUID()
    const ab = await blob.arrayBuffer()
    const bytes = new Uint8Array(ab)
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    const audioBase64 = btoa(bin)
    const payload = {
      type: 'transcribe',
      id,
      pass,
      mime,
      audioBase64,
    }
    console.info(
      '[LiveEngine][ws] send',
      JSON.stringify({ id, pass, mime, bytes: blob.size, b64Len: audioBase64.length }),
    )
    const result = new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      window.setTimeout(() => {
        const p = this.pending.get(id)
        if (!p) return
        this.pending.delete(id)
        reject(new Error('live_ws_timeout'))
      }, pass === 'draft' ? 3500 : 7000)
    })
    this.ws.send(JSON.stringify(payload))
    return result
  }
}

const singleton = new LiveCaptionRealtimeClient()

export async function transcribeHostedLiveRealtime(
  blob: Blob,
  mime: string,
  pass: 'draft' | 'final',
): Promise<string> {
  return singleton.transcribe(blob, mime, pass)
}

