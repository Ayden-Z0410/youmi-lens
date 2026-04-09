import type { ByokProviderId } from './providers/types'

/**
 * Dual-mode AI configuration (persisted locally).
 * - `youmi` - Youmi AI (platform hosted); no user key.
 * - `byok` - user-supplied key + chosen provider (advanced).
 */

export type AiSourceMode = 'youmi' | 'byok'

const LS_SOURCE = 'lc_ai_source'
const LS_BYOK_PROVIDER = 'lc_byok_provider'
const LS_BYOK_KEY = 'lc_byok_api_key'
/** Legacy single key; migrated once into BYOK OpenAI slot. */
const LS_LEGACY_OPENAI = 'lc_openai_key'

const EVENT = 'youmi-ai-source-changed'

let version = 0

function bump() {
  version += 1
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT))
  }
}

export function getAiSourceVersion(): number {
  return version
}

export function getAiSource(): AiSourceMode {
  if (typeof localStorage === 'undefined') return 'youmi'
  const s = localStorage.getItem(LS_SOURCE)
  if (s === 'byok') return 'byok'
  return 'youmi'
}

export function setAiSource(mode: AiSourceMode): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(LS_SOURCE, mode)
  bump()
}

export function getByokProvider(): ByokProviderId {
  if (typeof localStorage === 'undefined') return 'openai'
  const p = localStorage.getItem(LS_BYOK_PROVIDER)
  if (p === 'deepseek' || p === 'qwen' || p === 'openai') return p
  return 'openai'
}

export function setByokProvider(p: ByokProviderId): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(LS_BYOK_PROVIDER, p)
  bump()
}

export function getByokApiKey(): string {
  if (typeof localStorage === 'undefined') return ''
  let k = localStorage.getItem(LS_BYOK_KEY)?.trim() ?? ''
  if (!k && getByokProvider() === 'openai') {
    const leg = localStorage.getItem(LS_LEGACY_OPENAI)?.trim()
    if (leg) {
      k = leg
      localStorage.setItem(LS_BYOK_KEY, leg)
    }
  }
  return k
}

export function setByokApiKey(key: string): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(LS_BYOK_KEY, key.trim())
  bump()
}

export function subscribeAiSource(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }
  const fn = () => onStoreChange()
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}

export function getAiSourceSnapshot(): string {
  return `${getAiSource()}|${getByokProvider()}|${getByokApiKey().length}|${version}`
}

/** True when requests should use platform hosted routes (no user key). */
export function usesYoumiHosted(): boolean {
  return getAiSource() === 'youmi'
}
