import http from 'node:http'
import WebSocket from 'ws'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const sessions = []
  return {
    sessions,
    translateText: vi.fn(async (text) => `zh:${text}`),
    verifyJwt: vi.fn(async () => ({ userId: 'user-123456789', email: 'student@example.com' })),
    getEffectiveQuota: vi.fn(async () => ({ planType: 'student_basic' })),
    checkLiveSessionAllowed: vi.fn(async () => ({
      allowed: true,
      maxSessionMinutes: Infinity,
      body: {},
    })),
    recordBetaUsage: vi.fn(),
    getDashScopeHttpAttempts: vi.fn(() => [
      { key: 'dashscope-key', tag: 'test', bases: { wsInference: 'wss://dashscope.test/ws' } },
    ]),
    createDashscopeStreamingSession: vi.fn((_key, handlers) => {
      const session = {
        handlers,
        finish: vi.fn(() => handlers.onClose?.(true)),
        destroy: vi.fn(() => handlers.onClose?.(true)),
        sendPcm: vi.fn(),
      }
      sessions.push(session)
      queueMicrotask(() => handlers.onReady?.())
      return session
    }),
  }
})

vi.mock('./betaGate.mjs', () => ({
  verifyJwt: mocks.verifyJwt,
  getEffectiveQuota: mocks.getEffectiveQuota,
  checkLiveSessionAllowed: mocks.checkLiveSessionAllowed,
  recordBetaUsage: mocks.recordBetaUsage,
  BETA_ERROR_CODES: { AUTH_REQUIRED: 'auth_required' },
  BETA_LIMIT_MESSAGE: 'Live captions unavailable.',
}))

vi.mock('./ai/hosted/youmiHosted.mjs', () => ({
  translateText: mocks.translateText,
  hostedCapabilities: () => ({ liveCaptions: true }),
  transcribeAudio: vi.fn(),
  transcribeAudioFromUrl: vi.fn(),
}))

vi.mock('./dashscopeWithFallback.mjs', () => ({
  getDashScopeHttpAttempts: mocks.getDashScopeHttpAttempts,
}))

vi.mock('./dashscopeStreamingAsr.mjs', () => ({
  createDashscopeStreamingSession: mocks.createDashscopeStreamingSession,
}))

vi.mock('./deepgramStreamingAsr.mjs', () => ({
  createDeepgramStreamingSession: vi.fn(),
}))

vi.mock('./volcengineStreamingAsr.mjs', () => ({
  createVolcengineStreamingSession: vi.fn(),
  DEFAULT_VOLC_ASR_WS_URL: 'wss://volc.test/ws',
  DEFAULT_VOLC_ASR_RESOURCE_ID: 'resource-id',
}))

vi.mock('./watchLiveUsage.mjs', () => ({
  createDeepgramLiveCostFinalizer: vi.fn(),
}))

const { attachLiveRealtimeWs } = await import('./liveRealtimeWs.mjs')

function waitFor(predicate, label) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const poll = () => {
      if (predicate()) {
        resolve()
        return
      }
      if (Date.now() - started > 1000) {
        reject(new Error(`Timed out waiting for ${label}`))
        return
      }
      setTimeout(poll, 5)
    }
    poll()
  })
}

function waitForMessage(ws, predicate, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage)
      reject(new Error(`Timed out waiting for ${label}`))
    }, 1000)
    const onMessage = (raw) => {
      const msg = JSON.parse(String(raw))
      if (!predicate(msg)) return
      clearTimeout(timer)
      ws.off('message', onMessage)
      resolve(msg)
    }
    ws.on('message', onMessage)
  })
}

async function startLiveServer() {
  const server = http.createServer()
  const wss = attachLiveRealtimeWs(server)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: `ws://127.0.0.1:${port}/api/live-realtime-ws`,
    async close() {
      for (const client of wss.clients) client.terminate()
      await new Promise((resolve) => wss.close(resolve))
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

describe('live realtime translation buffer teardown', () => {
  let previousTranslationExperiment

  beforeEach(() => {
    previousTranslationExperiment = process.env.YOUMI_LIVE_TRANSLATION_EXPERIMENT
    process.env.YOUMI_LIVE_TRANSLATION_EXPERIMENT = 'enabled'
    mocks.sessions.length = 0
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (previousTranslationExperiment === undefined) {
      delete process.env.YOUMI_LIVE_TRANSLATION_EXPERIMENT
    } else {
      process.env.YOUMI_LIVE_TRANSLATION_EXPERIMENT = previousTranslationExperiment
    }
  })

  it('flushes an unpunctuated final translation buffer on stream_stop before the debounce timer', async () => {
    const liveServer = await startLiveServer()
    const ws = new WebSocket(liveServer.url)
    try {
      await new Promise((resolve, reject) => {
        ws.once('open', resolve)
        ws.once('error', reject)
      })

      ws.send(JSON.stringify({ type: 'stream_start', token: 'valid-token', sampleRate: 16000 }))
      await waitForMessage(ws, (msg) => msg.type === 'stream_ready', 'stream_ready')
      await waitFor(() => mocks.sessions.length === 1, 'dashscope session')

      mocks.sessions[0].handlers.onFinal('I have something to show you')
      await waitForMessage(ws, (msg) => msg.type === 'stream_final', 'stream_final')
      expect(mocks.translateText).not.toHaveBeenCalled()

      ws.send(JSON.stringify({ type: 'stream_stop' }))
      await waitFor(() => mocks.sessions[0].finish.mock.calls.length === 1, 'stream stop')

      expect(mocks.translateText).toHaveBeenCalledTimes(1)
      expect(mocks.translateText).toHaveBeenCalledWith('I have something to show you', 'zh')
    } finally {
      ws.terminate()
      await liveServer.close()
    }
  })
})
