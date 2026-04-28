/**
 * DashScope (Alibaba Model Studio) — server-only env resolution.
 *
 * - DASHSCOPE_API_KEY — default (China / standard endpoint).
 * - DASHSCOPE_OVERSEAS_API_KEY — optional international (Singapore) key; when set, all DashScope
 *   HTTP + streaming WS calls use the intl host with this key (overrides China key for hosted AI).
 *
 * Never log key material. Expose only booleans + region + keySource for /api/health.
 */

function trim(name) {
  return process.env[name]?.trim() || ''
}

export function getDashScopeChinaKey() {
  return trim('DASHSCOPE_API_KEY')
}

export function getDashScopeOverseasKey() {
  return trim('DASHSCOPE_OVERSEAS_API_KEY')
}

/** Key used for DashScope API calls (overseas key wins when present). */
export function getDashScopeEffectiveKey() {
  const o = getDashScopeOverseasKey()
  if (o) return o
  return getDashScopeChinaKey()
}

/** @returns {'overseas' | 'china' | 'none'} */
export function getDashScopeKeySource() {
  if (getDashScopeOverseasKey()) return 'overseas'
  if (getDashScopeChinaKey()) return 'china'
  return 'none'
}

/** @returns {'intl' | 'cn'} */
export function getDashScopeEffectiveRegion() {
  return getDashScopeOverseasKey() ? 'intl' : 'cn'
}

export function getDashScopeBases() {
  const intl = getDashScopeEffectiveRegion() === 'intl'
  if (intl) {
    return {
      compatChat: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
      paraformerSubmit: 'https://dashscope-intl.aliyuncs.com/api/v1/services/audio/asr/transcription',
      tasksPollBase: 'https://dashscope-intl.aliyuncs.com/api/v1/tasks',
      wsInference: 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference',
    }
  }
  return {
    compatChat: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    paraformerSubmit: 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription',
    tasksPollBase: 'https://dashscope.aliyuncs.com/api/v1/tasks',
    wsInference: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
  }
}

/** Secret-safe fields for diagnostics and /api/health. */
export function getDashScopeEnvSummary() {
  return {
    DASHSCOPE_API_KEY: Boolean(getDashScopeChinaKey()),
    DASHSCOPE_OVERSEAS_API_KEY: Boolean(getDashScopeOverseasKey()),
    dashscopeEffectiveRegion: getDashScopeEffectiveRegion(),
    dashscopeKeySource: getDashScopeKeySource(),
  }
}
