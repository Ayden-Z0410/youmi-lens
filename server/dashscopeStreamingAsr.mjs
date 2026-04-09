/**
 * DashScope Paraformer real-time streaming ASR session.
 *
 * Wraps one WebSocket connection to DashScope's streaming endpoint.
 * Receives raw PCM buffers from the caller and emits interim / final text.
 *
 * DashScope protocol:
 *   wss://dashscope.aliyuncs.com/api-ws/v1/inference
 *   1. open ? send run-task (JSON)
 *   2. receive task-started
 *   3. send binary PCM frames continuously
 *   4. receive result-generated (interim + final sentences)
 *   5. send finish-task (JSON)
 *   6. receive task-finished ? close
 *
 * Audio requirements: PCM signed 16-bit LE, mono, any sample rate (paraformer-realtime-v2).
 */

import { WebSocket } from 'ws'

const DASHSCOPE_WS = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'

function makeTaskId() {
  // 32-char hex UUID (DashScope requirement)
  return (typeof crypto !== 'undefined' ? crypto.randomUUID() : require('crypto').randomUUID())
    .replace(/-/g, '')
}

/**
 * @param {string} apiKey
 * @param {{
 *   sampleRate?: number,
 *   onInterim?: (text: string) => void,
 *   onFinal?: (text: string) => void,
 *   onError?: (err: Error) => void,
 *   onClose?: () => void,
 * }} callbacks
 * @returns {{ sendPcm(buf: Buffer): void, finish(): void, destroy(): void }}
 */
export function createDashscopeStreamingSession(apiKey, callbacks = {}) {
  const { sampleRate = 48000, onReady, onInterim, onFinal, onError, onClose } = callbacks
  const taskId = makeTaskId()

  let ws = null
  let started = false
  let finished = false
  const pcmQueue = []  // buffers received before task-started handshake completes

  const tag = taskId.slice(-8)
  const L = (msg, data) =>
    console.log(`[DashscopeStream][${tag}] ${msg}`, data ? JSON.stringify(data) : '')

  const drainQueue = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    for (const buf of pcmQueue) {
      try { ws.send(buf) } catch { /* ignore */ }
    }
    pcmQueue.length = 0
  }

  const sendPcm = (buf) => {
    if (finished) return
    const b = buf instanceof Buffer ? buf : Buffer.from(buf)
    if (!started) {
      // Queue until DashScope sends task-started
      pcmQueue.push(b)
      return
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    try { ws.send(b) } catch (e) { L('sendPcm error', { message: e?.message }) }
  }

  const finish = () => {
    if (finished || !started || !ws || ws.readyState !== WebSocket.OPEN) return
    finished = true
    try {
      ws.send(JSON.stringify({
        header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
        payload: { input: {} },
      }))
      L('finish-task sent')
    } catch (e) { L('finish-task error', { message: e?.message }) }
  }

  const destroy = () => {
    finished = true
    if (taskStartedTimer) { clearTimeout(taskStartedTimer); taskStartedTimer = null }
    pcmQueue.length = 0
    if (ws) {
      try { ws.close() } catch { /* ignore */ }
      ws = null
    }
  }

  // If DashScope never sends task-started within this window, surface the error to the client.
  const TASK_STARTED_TIMEOUT_MS = 8000
  let taskStartedTimer = setTimeout(() => {
    taskStartedTimer = null
    if (!started) {
      const msg = `DashScope task-started timeout after ${TASK_STARTED_TIMEOUT_MS}ms — WS connected but ASR session never confirmed`
      L('task-started TIMEOUT', { sampleRate })
      onError?.(new Error(msg))
    }
  }, TASK_STARTED_TIMEOUT_MS)

  ws = new WebSocket(DASHSCOPE_WS, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'user-agent': 'youmi-lens-server/1.0',
    },
  })

  ws.on('open', () => {
    L('ws open', { sampleRate })
    const runTask = {
      header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
      payload: {
        task_group: 'audio',
        task: 'asr',
        function: 'recognition',
        model: 'paraformer-realtime-v2',
        parameters: {
          format: 'pcm',
          sample_rate: sampleRate,
          language_hints: ['zh', 'en'],
          disfluency_removal_enabled: false,
        },
        input: {},
      },
    }
    try { ws.send(JSON.stringify(runTask)) } catch (e) { L('run-task error', { message: e?.message }) }
  })

  ws.on('message', (data) => {
    let msg
    try { msg = JSON.parse(String(data)) } catch { return }

    const action = msg?.header?.action || msg?.header?.event
    if (!action) return

    if (action === 'task-started') {
      started = true
      L('task-started -> drain queue', { queued: pcmQueue.length })
      if (taskStartedTimer) { clearTimeout(taskStartedTimer); taskStartedTimer = null }
      drainQueue()
      onReady?.()
      return
    }

    if (action === 'result-generated') {
      const sentence = msg?.payload?.output?.sentence
      if (!sentence?.text) return
      const text = sentence.text.trim()
      if (!text) return
      if (sentence.sentence_end) {
        L('final', { len: text.length })
        onFinal?.(text)
      } else {
        L('interim', { len: text.length })
        onInterim?.(text)
      }
      return
    }

    if (action === 'task-finished') {
      L('task-finished')
      return
    }

    if (action === 'task-failed') {
      const errMsg = msg?.header?.error_message || 'DashScope ASR task failed'
      L('task-failed', { error: errMsg })
      onError?.(new Error(errMsg))
    }
  })

  ws.on('error', (err) => {
    L('ws error', { message: err?.message })
    onError?.(err instanceof Error ? err : new Error(String(err)))
  })

  ws.on('close', () => {
    L('ws closed')
    onClose?.()
  })

  return { sendPcm, finish, destroy }
}
