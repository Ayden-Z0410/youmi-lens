/**
 * Volcengine / ByteDance streaming ASR (bigmodel v3 async).
 *
 * WebSocket: wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async (default)
 *
 * Auth (switch via VOLCENGINE_AUTH_MODE):
 *   legacy_headers: X-Api-* four headers (APP ID + Access Token + Resource + Connect-Id)
 *   api_key: experiment Authorization Bearer; token + X-Api-Resource-Id + X-Api-Connect-Id
 *
 * After connect: binary FullClientRequest + AudioOnly (gzip JSON / gzip PCM).
 */

import { WebSocket } from 'ws'
import zlib from 'zlib'

/** @typedef {'legacy_headers' | 'api_key'} VolcAuthMode */

export const AUTH_MODE_LEGACY = 'legacy_headers'
export const AUTH_MODE_API_KEY = 'api_key'

/** Normalize env VOLCENGINE_AUTH_MODE */
export function normalizeVolcAuthMode(raw) {
  const m = String(raw ?? '').trim().toLowerCase()
  if (m === AUTH_MODE_API_KEY || m === 'apikey' || m === 'bearer' || m === 'bearer_token') return AUTH_MODE_API_KEY
  return AUTH_MODE_LEGACY
}

/**
 * Build WebSocket handshake headers + safe diagnostic (no secret values).
 * @param {{
 *   authMode: VolcAuthMode,
 *   appKey?: string,
 *   accessKey?: string,
 *   apiKey?: string,
 *   resourceId: string,
 *   connectId: string,
 *   wsUrl: string,
 * }} opts
 */
export function buildVolcOpenspeechHandshake(opts) {
  const { authMode, appKey = '', accessKey = '', apiKey = '', resourceId, connectId, wsUrl } = opts

  const diag = {
    authMode,
    headerXApiAppKey: false,
    headerXApiAccessKey: false,
    headerAuthorization: false,
    resourceId,
    wsUrl,
  }

  const headers = {}

  if (authMode === AUTH_MODE_API_KEY) {
    const token = (apiKey || '').trim()
    if (!token) {
      const err = new Error('VOLCENGINE_API_KEY_MODE_MISSING_TOKEN')
      err.code = 'VOLC_AUTH_CONFIG'
      throw err
    }
    // Doubao / openspeech token form: "Bearer; " + token (semicolon)
    headers.Authorization = `Bearer; ${token}`
    diag.headerAuthorization = true
    headers['X-Api-Resource-Id'] = resourceId
    headers['X-Api-Connect-Id'] = connectId
  } else {
    const ak = (appKey || '').trim()
    const sk = (accessKey || '').trim()
    if (!ak || !sk) {
      const err = new Error('VOLCENGINE_LEGACY_MODE_MISSING_APP_OR_ACCESS_KEY')
      err.code = 'VOLC_AUTH_CONFIG'
      throw err
    }
    headers['X-Api-App-Key'] = ak
    headers['X-Api-Access-Key'] = sk
    headers['X-Api-Resource-Id'] = resourceId
    headers['X-Api-Connect-Id'] = connectId
    diag.headerXApiAppKey = true
    diag.headerXApiAccessKey = true
  }

  return { headers, diag }
}

const PROTO_VER    = 0x1
const HDR_SIZE     = 0x1
const MSG_FULL_REQ = 0x1
const MSG_AUDIO    = 0x2
const MSG_FULL_RES = 0x9
const MSG_ERROR    = 0xF
const FLAG_LAST    = 0x2
const SER_JSON     = 0x1
const SER_NONE     = 0x0
const CMP_GZIP     = 0x1

export const DEFAULT_VOLC_ASR_WS_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async'
export const DEFAULT_VOLC_ASR_RESOURCE_ID = 'volc.seedasr.sauc.duration'

const TARGET_RATE = 16_000
const CHUNK_MS    = 100

function makeUuid() {
  return typeof crypto !== 'undefined' ? crypto.randomUUID() : require('crypto').randomUUID()
}

function makeReqId() {
  return makeUuid().replace(/-/g, '')
}

function makeHeader(msgType, flags, ser, cmp) {
  return Buffer.from([
    ((PROTO_VER & 0xF) << 4) | (HDR_SIZE & 0xF),
    ((msgType   & 0xF) << 4) | (flags    & 0xF),
    ((ser       & 0xF) << 4) | (cmp      & 0xF),
    0x00,
  ])
}

function buildFullClientRequest(payload) {
  const json = Buffer.from(JSON.stringify(payload))
  const body = zlib.gzipSync(json)
  const h    = makeHeader(MSG_FULL_REQ, 0x0, SER_JSON, CMP_GZIP)
  const sz   = Buffer.alloc(4)
  sz.writeUInt32BE(body.length, 0)
  return Buffer.concat([h, sz, body])
}

function buildAudioFrame(pcm16k, isLast) {
  const body = zlib.gzipSync(pcm16k)
  const h    = makeHeader(MSG_AUDIO, isLast ? FLAG_LAST : 0x0, SER_NONE, CMP_GZIP)
  const sz   = Buffer.alloc(4)
  sz.writeUInt32BE(body.length, 0)
  return Buffer.concat([h, sz, body])
}

function parseBinaryResponse(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf)
  if (buf.length < 8) return null

  const hdrBytes = (buf[0] & 0xF) * 4
  const msgType  = (buf[1] >> 4) & 0xF
  const cmp      = buf[2] & 0xF

  if (msgType === MSG_ERROR) {
    const code    = buf.readUInt32BE(hdrBytes)
    const msgLen  = buf.readUInt32BE(hdrBytes + 4)
    const message = buf.slice(hdrBytes + 8, hdrBytes + 8 + msgLen).toString('utf8')
    return { _error: true, code, message }
  }

  if (msgType === MSG_FULL_RES) {
    const payloadSize = buf.readUInt32BE(hdrBytes)
    let payload = buf.slice(hdrBytes + 4, hdrBytes + 4 + payloadSize)
    if (cmp === CMP_GZIP) payload = zlib.gunzipSync(payload)
    return JSON.parse(payload.toString('utf8'))
  }

  return null
}

/** Try plain JSON (v3 may send text frames). */
function tryParseJsonMessage(data) {
  const s = Buffer.isBuffer(data) ? data.toString('utf8').trim() : String(data).trim()
  if (!s.startsWith('{') && !s.startsWith('[')) return null
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function normalizeAsrPayload(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (raw._error) return raw
  return raw
}

/** bigmodel_async uses result.utterances; legacy v2 used result[0].utterances */
function extractUtterances(payload) {
  const r = payload?.result
  if (!r) return null
  if (Array.isArray(r) && r[0]?.utterances) return r[0].utterances
  if (r.utterances && Array.isArray(r.utterances)) return r.utterances
  return null
}

function extractDisplayText(payload) {
  const r = payload?.result
  if (!r) return ''
  if (typeof r.text === 'string' && r.text.trim()) return r.text.trim()
  const u = extractUtterances(payload)
  if (u?.length) return u.map((x) => x.text).join(' ').trim()
  return ''
}

function resamplePcm(input, fromRate) {
  if (fromRate === TARGET_RATE) return input
  const inLen  = input.length / 2
  const outLen = Math.round(inLen * TARGET_RATE / fromRate)
  const out    = Buffer.alloc(outLen * 2)
  for (let i = 0; i < outLen; i++) {
    const pos  = (i * fromRate) / TARGET_RATE
    const idx  = Math.min(Math.floor(pos), inLen - 2)
    const frac = pos - idx
    const s0   = input.readInt16LE(idx * 2)
    const s1   = input.readInt16LE((idx + 1) * 2)
    const s    = Math.round(s0 + frac * (s1 - s0))
    out.writeInt16LE(Math.max(-32768, Math.min(32767, s)), i * 2)
  }
  return out
}

/**
 * @param {{
 *   authMode?: VolcAuthMode,
 *   appKey?: string,
 *   accessKey?: string,
 *   apiKey?: string,
 *   resourceId: string,
 *   wsUrl?: string,
 * }} credentials
 */
export function createVolcengineStreamingSession(credentials, callbacks = {}) {
  const {
    authMode = AUTH_MODE_LEGACY,
    appKey = '',
    accessKey = '',
    apiKey = '',
    resourceId,
    wsUrl = DEFAULT_VOLC_ASR_WS_URL,
  } = credentials

  const {
    sampleRate = 48_000,
    onReady, onInterim, onFinal, onError, onClose,
  } = callbacks

  const connectId = makeUuid()
  const reqId     = makeReqId()
  const tag       = reqId.slice(-8)
  const L = (msg, data) =>
    console.log(`[VolcASR][${tag}] ${msg}`, data !== undefined ? JSON.stringify(data) : '')

  let ws          = null
  let ready       = false
  let stopped     = false
  let intentional = false
  let pcmAccum    = Buffer.alloc(0)
  let chunkTimer  = null
  const T0            = Date.now()
  let T_first_interim = 0

  function drainChunk(isLast = false) {
    if (!ws || ws.readyState !== ws.OPEN) return
    const raw = pcmAccum
    pcmAccum  = Buffer.alloc(0)
    if (raw.length === 0 && !isLast) return
    try {
      const pcm16k = resamplePcm(raw, sampleRate)
      const frame  = buildAudioFrame(pcm16k, isLast)
      ws.send(frame)
    } catch (err) {
      L('drainChunk error', { message: err.message })
    }
  }

  function tick() {
    chunkTimer = null
    drainChunk(false)
    if (!stopped) chunkTimer = setTimeout(tick, CHUNK_MS)
  }

  function handleServerPayload(result) {
    const payload = normalizeAsrPayload(result)
    if (!payload) return

    if (payload._error) {
      L('server protocol error', { code: payload.code, message: payload.message })
      onError?.(new Error(`VolcASR proto error ${payload.code}: ${payload.message}`))
      return
    }

    if (payload.code !== undefined && payload.code !== 1000) {
      L('ASR error status', { code: payload.code, message: payload.message })
      onError?.(new Error(`VolcASR error ${payload.code}: ${payload.message ?? ''}`))
      return
    }

    if (!ready && (payload.code === 1000 || payload.code === undefined)) {
      ready = true
      L('provider ready', { readyMs: Date.now() - T0, connectId })
      onReady?.()
    }

    const text = extractDisplayText(payload)
    if (!text) return

    const utterances = extractUtterances(payload)
    const isFinal =
      utterances?.length
        ? utterances.every((u) => u.definite === true)
        : Boolean(payload.result?.is_final ?? payload.is_final)

    if (isFinal) {
      L('FINAL', { text: text.slice(0, 80), ms: Date.now() - T0 })
      onFinal?.(text)
    } else {
      if (!T_first_interim) {
        T_first_interim = Date.now()
        L('first INTERIM', { ms: T_first_interim - T0, text: text.slice(0, 50) })
      }
      onInterim?.(text)
    }
  }

  let handshakeHeaders
  let handshakeDiag
  try {
    const built = buildVolcOpenspeechHandshake({
      authMode,
      appKey,
      accessKey,
      apiKey,
      resourceId,
      connectId,
      wsUrl,
    })
    handshakeHeaders = built.headers
    handshakeDiag = built.diag
  } catch (err) {
    L('handshake config error', { message: err.message, code: err.code })
    throw err
  }

  L('auth handshake plan', handshakeDiag)

  L('connecting', { wsUrl, sampleRate, resourceId, connectId, authMode })

  ws = new WebSocket(wsUrl, { headers: handshakeHeaders })

  ws.on('unexpected-response', (_req, res) => {
    L('WS handshake rejected', {
      statusCode: res.statusCode,
      statusMessage: res.statusMessage,
      authMode,
      hint:
        authMode === AUTH_MODE_API_KEY
          ? 'api_key mode: verify VOLCENGINE_ASR_API_KEY (or ACCESS_KEY as sole token) and Resource-Id; try legacy_headers if 401 persists'
          : 'legacy_headers: X-Api-App-Key = speech APPID, X-Api-Access-Key = Access Token for that app',
    })
  })

  ws.on('open', () => {
    L('open - sending FullClientRequest (bigmodel_async JSON)', { authMode })
    try {
      // Payload aligned with openspeech bigmodel_async (see volcengine koe-asr doubao.rs).
      const frame = buildFullClientRequest({
        user: { uid: `youmi-${Date.now()}` },
        audio: {
          format: 'pcm',
          codec:  'raw',
          rate:   TARGET_RATE,
          bits:   16,
          channel: 1,
        },
        request: {
          model_name:       'bigmodel',
          enable_itn:       true,
          enable_punc:      true,
          enable_ddc:       true,
          enable_nonstream: true,
          result_type:      'full',
          show_utterances:  true,
        },
      })
      ws.send(frame)
      chunkTimer = setTimeout(tick, CHUNK_MS)
    } catch (err) {
      L('open handler error', { message: err.message })
      onError?.(err)
    }
  })

  ws.on('message', (data) => {
    let result = null
    try {
      result = parseBinaryResponse(data)
      if (!result) result = tryParseJsonMessage(data)
    } catch (err) {
      L('parse error', { message: err.message })
      return
    }
    if (!result) return
    try {
      handleServerPayload(result)
    } catch (err) {
      L('handleServerPayload error', { message: err.message })
    }
  })

  ws.on('error', (err) => {
    L('WS error', { message: err.message })
    onError?.(err)
  })

  ws.on('close', (code) => {
    if (chunkTimer) { clearTimeout(chunkTimer); chunkTimer = null }
    L('WS closed', { code, intentional, connectId })
    onClose?.(intentional)
  })

  return {
    sendPcm(buf) {
      if (stopped) return
      const chunk = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
      pcmAccum = Buffer.concat([pcmAccum, chunk])
      const maxBytes = Math.ceil(sampleRate * 3 * 2)
      if (pcmAccum.length > maxBytes) {
        L('pcmAccum overflow - dropping oldest audio', { droppedBytes: pcmAccum.length - maxBytes })
        pcmAccum = pcmAccum.slice(pcmAccum.length - maxBytes)
      }
    },

    stop() {
      if (stopped) return
      stopped     = true
      intentional = true
      if (chunkTimer) { clearTimeout(chunkTimer); chunkTimer = null }
      drainChunk(true)
      L('stop - last audio frame sent')
    },

    destroy() {
      stopped     = true
      intentional = true
      if (chunkTimer) { clearTimeout(chunkTimer); chunkTimer = null }
      try { ws?.terminate() } catch { /* ignore */ }
    },
  }
}
