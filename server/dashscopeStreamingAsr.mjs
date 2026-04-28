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
import { getDashScopeBases } from './dashscopeEnv.mjs'

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
  let taskFinished = false   // set when DashScope sends task-finished (intentional close)
  let diagLogged = false
  const pcmQueue = []  // buffers received before task-started handshake completes

  // Latency instrumentation
  const T_create = Date.now()
  let T_ws_open = 0
  let T_task_started = 0
  let T_first_interim = 0
  let T_first_final = 0
  let interimCount = 0

  /** When DashScope rarely sets sentence_end, interims never become finals  UI stuck in gray. Commit after brief audio pause. */
  const PAUSE_COMMIT_MS = Number(process.env.YOUMI_LIVE_PAUSE_COMMIT_MS || 580)
  let pauseCommitTimer = null
  let latestInterimText = ''
  let lastEmittedFinalText = ''
  let lastEmittedFinalAt = 0

  const tag = taskId.slice(-8)
  const L = (msg, data) =>
    console.log(`[DashscopeStream][${tag}] ${msg}`, data ? JSON.stringify(data) : '')

  function truthySentenceEnd(v) {
    return v === true || v === 'true' || v === 1 || v === '1'
  }

  function clearPauseCommitTimer() {
    if (pauseCommitTimer) {
      clearTimeout(pauseCommitTimer)
      pauseCommitTimer = null
    }
  }

  function emitFinalDeduped(text, reason) {
    const t = (text || '').trim()
    if (!t) return
    const now = Date.now()
    if (t === lastEmittedFinalText && now - lastEmittedFinalAt < 2000) {
      L('final deduped (same text)', { reason, len: t.length })
      return
    }
    lastEmittedFinalText = t
    lastEmittedFinalAt = now
    if (!T_first_final) {
      T_first_final = now
      L('TIMING first-final', {
        reason,
        totalMs: T_first_final - T_create,
        sinceTaskStarted: T_task_started ? T_first_final - T_task_started : -1,
      })
    }
    L('final', { reason, len: t.length, sinceStartMs: now - T_create })
    onFinal?.(t)
  }

  function schedulePauseCommitFinal() {
    clearPauseCommitTimer()
    pauseCommitTimer = setTimeout(() => {
      pauseCommitTimer = null
      emitFinalDeduped(latestInterimText, 'pause_commit')
    }, PAUSE_COMMIT_MS)
  }

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
    clearPauseCommitTimer()
    if (latestInterimText.trim()) {
      emitFinalDeduped(latestInterimText, 'flush_on_finish_task')
      latestInterimText = ''
    }
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
    clearPauseCommitTimer()
    finished = true
    taskFinished = true  // treat explicit destroy as intentional so onClose doesn't alert client
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
      const msg = `DashScope task-started timeout after ${TASK_STARTED_TIMEOUT_MS}ms -- WS connected but ASR session never confirmed`
      L('task-started TIMEOUT', { sampleRate })
      onError?.(new Error(msg))
    }
  }, TASK_STARTED_TIMEOUT_MS)

  const wsUrl = getDashScopeBases().wsInference
  ws = new WebSocket(wsUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'user-agent': 'youmi-lens-server/1.0',
    },
  })

  ws.on('open', () => {
    T_ws_open = Date.now()
    L('ws open', { sampleRate, wsConnectMs: T_ws_open - T_create })
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
          // en first: Paraformer tunes phoneme priors to the first hint; listing zh first
          // delays English output by ~500-1500ms while the model re-scores Chinese hypotheses.
          language_hints: ['en', 'zh'],
          disfluency_removal_enabled: false,
          // Without this, DashScope often holds one mega-sentence for 30s+ with sentence_end=false,
          // so the client never gets en_final commits and the transcript looks like "one line".
          semantic_punctuation_enabled: true,
          // VAD silence cap (ms) to end a sentence; doc range 2006000, default ~800.
          max_sentence_silence: 700,
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
      T_task_started = Date.now()
      started = true
      L('task-started -> drain queue', {
        queued: pcmQueue.length,
        wsConnectMs: T_ws_open - T_create,
        taskStartedMs: T_task_started - T_create,
      })
      if (taskStartedTimer) { clearTimeout(taskStartedTimer); taskStartedTimer = null }
      drainQueue()
      onReady?.()
      return
    }

    if (action === 'result-generated') {
      const sentence = msg?.payload?.output?.sentence
      if (!sentence || sentence.heartbeat === true) return
      if (!sentence.text) return
      const text = sentence.text.trim()
      if (!text) return
      // Log the raw sentence object once to confirm field names in Railway logs
      if (!diagLogged) {
        L('sentence-diag (first result)', { keys: Object.keys(sentence), sentence_end: sentence.sentence_end, is_sentence_end: sentence.is_sentence_end })
        diagLogged = true
      }
      // DashScope uses sentence_end / is_sentence_end; payloads may use bool, string, or 1.
      const endFlag = sentence.sentence_end ?? sentence.is_sentence_end
      const isFinal = truthySentenceEnd(endFlag)
      const now = Date.now()
      if (isFinal) {
        clearPauseCommitTimer()
        emitFinalDeduped(text, 'api_sentence_end')
      } else {
        interimCount++
        if (!T_first_interim) {
          T_first_interim = now
          L('TIMING first-interim', {
            totalMs: T_first_interim - T_create,         // create?first interim
            sinceTaskStarted: T_task_started ? T_first_interim - T_task_started : -1,  // task-started?first interim
            wsConnectMs: T_ws_open - T_create,
            taskStartedMs: T_task_started ? T_task_started - T_create : -1,
          })
        }
        latestInterimText = text
        schedulePauseCommitFinal()
        onInterim?.(text)
      }
      return
    }

    if (action === 'task-finished') {
      clearPauseCommitTimer()
      taskFinished = true
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
    // intentional = finished via finish-task (task-finished received) or explicitly destroyed
    const intentional = taskFinished || finished
    L('ws closed', { intentional })
    onClose?.(intentional)
  })

  return { sendPcm, finish, destroy }
}
