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
/** @deprecated in Volc WS doc; some services still emit it */
const MSG_FULL_SERVER_RES = 0x9
/** Volc binary protocol: server ACK / result (replaces 0x9 in newer docs) */
const MSG_AUDIO_ONLY_SERVER = 0xb
const MSG_ERROR = 0xf
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

/**
 * Decode one Volc / openspeech WebSocket binary frame (big-endian).
 * Layout: [header][payload_size: u32 BE][payload bytesù]
 * Byte0: version (high nibble) | header_units (low nibble); header_len = units * 4 (units 0 ? treat as 1).
 * Byte1: message_type (high) | flags (low)
 * Byte2: serialization (high) | compression (low)
 * Byte3: reserved (0)
 * Error frames (type 0xF): no separate payload_size; body is code:u32 + msg_len:u32 + msg utf-8.
 * @see https://www.volcengine.com/docs/6561/79821 (binary message format; 0x9 deprecated, 0xB server ACK)
 */
function parseOpenspeechBinaryFrame(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf)
  if (buf.length < 4) return null

  const b0 = buf[0]
  let headerUnits = b0 & 0xf
  if (headerUnits === 0) headerUnits = 1
  let headerLen = headerUnits * 4
  if (headerUnits === 0xf) {
    // Volc doc: >= 60 B header + extension; layout not implemented ù skip safely.
    return null
  }

  if (buf.length < headerLen) return null

  const msgType = (buf[1] >> 4) & 0xf
  const serialization = (buf[2] >> 4) & 0xf
  const compression = buf[2] & 0xf

  const frameMeta = (extra) => ({
    msgType,
    serialization,
    compression,
    wasGzip: extra.wasGzip,
    isResultFrame: extra.isResultFrame,
  })

  if (msgType === MSG_ERROR) {
    if (buf.length < headerLen + 8) return null
    const code = buf.readUInt32BE(headerLen)
    const msgLen = buf.readUInt32BE(headerLen + 4)
    if (buf.length < headerLen + 8 + msgLen) return null
    const message = buf.slice(headerLen + 8, headerLen + 8 + msgLen).toString('utf8')
    return {
      payload: { _error: true, code, message },
      frame: frameMeta({ wasGzip: false, isResultFrame: false }),
    }
  }

  const isPayloadFrame =
    msgType === MSG_FULL_SERVER_RES || msgType === MSG_AUDIO_ONLY_SERVER
  if (!isPayloadFrame) return null

  if (buf.length < headerLen + 4) return null
  const payloadSize = buf.readUInt32BE(headerLen)
  if (buf.length < headerLen + 4 + payloadSize) return null

  let body = buf.slice(headerLen + 4, headerLen + 4 + payloadSize)
  if (body.length === 0) return null

  let useGzip = compression === CMP_GZIP
  if (!useGzip && body.length >= 2 && body[0] === 0x1f && body[1] === 0x8b) {
    useGzip = true
  }
  if (useGzip) {
    try {
      body = zlib.gunzipSync(body)
    } catch {
      return null
    }
  }

  const wantJson =
    serialization === SER_JSON ||
    (serialization === SER_NONE && body[0] === 0x7b)
  if (!wantJson) return null

  const text = body.toString('utf8')
  try {
    const parsed = JSON.parse(text)
    return {
      payload: parsed,
      frame: frameMeta({ wasGzip: useGzip, isResultFrame: true }),
    }
  } catch {
    return null
  }
}

/** Text WebSocket frames only ù never UTF-8ùdecode binary ASR frames here. */
function tryParseJsonTextMessage(data) {
  if (typeof data !== 'string') return null
  const s = data.trim()
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
    wsSessionId = '',
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

  let pcmChunksIn     = 0
  let pcmBytesIn      = 0
  let lastPcmAt       = 0
  let volcFramesOut   = 0
  let volcBytesOut    = 0
  let lastVolcSendAt  = 0
  let volcRxFrameSeq  = 0
  let emitInterimSeq  = 0
  let emitFinalSeq    = 0

  function logPcmIn(chunkLen, accumAfter) {
    pcmChunksIn += 1
    pcmBytesIn  += chunkLen
    lastPcmAt    = Date.now()
    const n = pcmChunksIn
    if (n === 1 || n === 20 || n === 50 || (n % 100 === 0)) {
      L('pcm chunk in', {
        wsSessionId,
        pcmChunksIn,
        pcmBytesIn,
        chunkByteLength: chunkLen,
        sampleRate,
        lastPcmAt,
        accumBytes: accumAfter,
      })
    }
  }

  function drainChunk(isLast = false) {
    if (!ws || ws.readyState !== ws.OPEN) return
    const raw = pcmAccum
    pcmAccum  = Buffer.alloc(0)
    if (raw.length === 0 && !isLast) return
    try {
      const didResample = sampleRate !== TARGET_RATE
      const pcm16k      = resamplePcm(raw, sampleRate)
      const frame       = buildAudioFrame(pcm16k, isLast)
      ws.send(frame)
      volcFramesOut  += 1
      volcBytesOut   += frame.length
      lastVolcSendAt  = Date.now()
      const n = volcFramesOut
      if (n === 1 || n === 10 || (n % 50 === 0) || isLast) {
        L('audio frame to Volc', {
          wsSessionId,
          volcFramesOut,
          volcBytesOut,
          frameByteLength: frame.length,
          readyState: ws.readyState,
          resampled: didResample,
          compressed: true,
          sampleRate,
          clientPcmBytesThisTick: raw.length,
          pcm16kBytes: pcm16k.length,
          lastVolcSendAt,
          targetRate: TARGET_RATE,
          isLast,
        })
      }
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
      emitFinalSeq += 1
      L('emit onFinal', {
        phase: 'pre',
        wsSessionId,
        segId: emitFinalSeq,
        textLen: text.length,
        preview: text.slice(0, 80),
        ms: Date.now() - T0,
      })
      L('FINAL', { text: text.slice(0, 80), ms: Date.now() - T0 })
      onFinal?.(text)
      L('emit onFinal', {
        phase: 'post',
        wsSessionId,
        segId: emitFinalSeq,
        textLen: text.length,
        preview: text.slice(0, 80),
      })
    } else {
      emitInterimSeq += 1
      if (!T_first_interim) {
        T_first_interim = Date.now()
        L('first INTERIM', { ms: T_first_interim - T0, text: text.slice(0, 50) })
      }
      L('emit onInterim', {
        phase: 'pre',
        wsSessionId,
        segId: emitInterimSeq,
        textLen: text.length,
        preview: text.slice(0, 80),
      })
      onInterim?.(text)
      L('emit onInterim', {
        phase: 'post',
        wsSessionId,
        segId: emitInterimSeq,
        textLen: text.length,
        preview: text.slice(0, 80),
      })
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
    let decoded = null
    try {
      if (typeof data === 'string') {
        const p = tryParseJsonTextMessage(data)
        if (p) decoded = { payload: p, frame: null }
      } else {
        decoded = parseOpenspeechBinaryFrame(data)
      }
    } catch (err) {
      L('parse error', { message: err.message })
      return
    }
    if (!decoded) return
    const { payload, frame } = decoded

    try {
      if (frame?.isResultFrame) {
        volcRxFrameSeq += 1
        const utt    = extractUtterances(payload)
        const disp   = extractDisplayText(payload)
        const r      = payload.result
        const rText  = typeof r?.text === 'string' ? r.text : ''
        const definite =
          utt?.length ? utt.every((u) => u.definite === true) : null
        const resultKeys =
          r && typeof r === 'object' && !Array.isArray(r)
            ? Object.keys(r)
            : []
        L('volc result frame', {
          wsSessionId,
          seq: volcRxFrameSeq,
          messageType: `0x${frame.msgType.toString(16)}`,
          resultKeys,
          hasUtterances: Boolean(utt?.length),
          displayLen: disp.length,
          definite,
          textPreview: rText.slice(0, 80),
          code: payload.code,
          topKeys: Object.keys(payload),
          ser: frame.serialization,
          cmp: frame.compression,
          wasGzip: frame.wasGzip,
        })
        if (!payload._error && disp.length === 0) {
          L('volc parsed no transcript', {
            wsSessionId,
            seq: volcRxFrameSeq,
            messageType: `0x${frame.msgType.toString(16)}`,
            resultKeys,
            hasUtterances: Boolean(utt?.length),
            displayLen: 0,
            definite,
            textPreview: rText.slice(0, 80),
            resultType: r == null ? 'null' : Array.isArray(r) ? 'array' : typeof r,
          })
        }
      } else if (frame && !frame.isResultFrame && frame.msgType === MSG_ERROR) {
        L('volc error frame wire', {
          msgTypeHex: `0x${frame.msgType.toString(16)}`,
          ser: frame.serialization,
          cmp: frame.compression,
        })
      } else if (!frame && payload && typeof payload === 'object') {
        L('volc text json frame', { topKeys: Object.keys(payload) })
      }
    } catch (err) {
      L('volc frame diag error', { message: err.message })
    }

    try {
      handleServerPayload(payload)
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
      logPcmIn(chunk.length, pcmAccum.length)
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
