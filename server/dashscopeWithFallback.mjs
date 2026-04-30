/**
 * DashScope HTTP calls with runtime fallback: try international endpoint + overseas key first
 * (when configured), then China endpoint + China key on failure.
 */

import {
  getDashScopeChinaKey,
  getDashScopeOverseasKey,
} from './dashscopeEnv.mjs'

export const DASHSCOPE_BASES_INTL = {
  compatChat: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
  paraformerSubmit: 'https://dashscope-intl.aliyuncs.com/api/v1/services/audio/asr/transcription',
  tasksPollBase: 'https://dashscope-intl.aliyuncs.com/api/v1/tasks',
  wsInference: 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference',
}

export const DASHSCOPE_BASES_CN = {
  compatChat: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  paraformerSubmit: 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription',
  tasksPollBase: 'https://dashscope.aliyuncs.com/api/v1/tasks',
  wsInference: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
}

const DEFAULT_FETCH_TIMEOUT_MS = Number(process.env.DASHSCOPE_FETCH_TIMEOUT_MS || 120_000)

/**
 * Ordered HTTP/WS attempts: international host + overseas key first (when set),
 * then China host + china key, or China host + same overseas key if no china key (endpoint fallback).
 */
export function getDashScopeHttpAttempts() {
  const ok = getDashScopeOverseasKey()
  const ck = getDashScopeChinaKey()
  /** @type {{ tag: string, bases: typeof DASHSCOPE_BASES_CN, key: string }[]} */
  const out = []
  if (ok) {
    out.push({ tag: 'intl_overseas_key', bases: DASHSCOPE_BASES_INTL, key: ok })
  }
  if (ck) {
    out.push({ tag: 'cn_china_key', bases: DASHSCOPE_BASES_CN, key: ck })
  } else if (ok) {
    out.push({ tag: 'cn_same_key_fallback', bases: DASHSCOPE_BASES_CN, key: ok })
  }
  const dedup = []
  for (const a of out) {
    const prev = dedup[dedup.length - 1]
    if (prev && prev.bases === a.bases && prev.key === a.key) continue
    dedup.push(a)
  }
  return dedup
}

/**
 * Run async op(bases, key) for each attempt until one succeeds.
 * @template T
 * @param {{ name: string, op: (a: { bases: typeof DASHSCOPE_BASES_CN, key: string, tag: string }) => Promise<T> }} opts
 */
export async function withDashScopeHttpFallback({ name, op }) {
  const attempts = getDashScopeHttpAttempts()
  if (!attempts.length) throw new Error('DASHSCOPE_NO_KEY')
  let lastErr = null
  for (const att of attempts) {
    try {
      const result = await op(att)
      console.warn(
        `[DashScopeFallback] ${name} ok`,
        JSON.stringify({ attempt: att.tag, region: att.bases === DASHSCOPE_BASES_INTL ? 'intl' : 'cn' }),
      )
      return result
    } catch (e) {
      lastErr = e
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(
        `[DashScopeFallback] ${name} attempt failed`,
        JSON.stringify({ attempt: att.tag, message: msg.slice(0, 200) }),
      )
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/**
 * fetch() with timeout; used so fallback can trigger on hang.
 */
export async function dashScopeFetch(url, init) {
  const ms = DEFAULT_FETCH_TIMEOUT_MS
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ac.signal })
  } finally {
    clearTimeout(t)
  }
}
