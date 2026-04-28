import { isDeveloperAiMode } from '../productAi'
import { getAiSource } from './aiSource'

export type HostedHealthSnapshot = {
  ready: boolean
  /** After-class transcript + summaries (process-recording). */
  postClassTranscript?: boolean
  /**
   * True when `/api/live-transcribe-url` can run (DashScope Paraformer via signed Storage URL, or OpenAI fallback).
   * Independent from post-class pipeline.
   */
  liveCaptions?: boolean
  /** V1 product hints from `/api/health` (optional on older servers). */
  product?: {
    v1PrimaryFlow?: string
    liveCaptions?: string
  }
  /** Provider readiness (secret-safe booleans only). */
  providerReadiness?: {
    dashscope?: {
      configured?: boolean
      region?: string
      keySource?: string
    }
    openaiFallback?: { configured?: boolean }
    postClass?: {
      transcribe?: boolean
      summarize?: boolean
      translate?: boolean
      ready?: boolean
    }
    liveRealtimeAsr?: { provider?: string; ready?: boolean }
  }
  mode?: {
    hostedRuntimeMode?: 'hosted' | 'stub' | 'unconfigured'
    stubAiEnabled?: boolean
  }
}

function parseOptionalBool(v: unknown): boolean | undefined {
  if (v === true || v === 'true') return true
  if (v === false || v === 'false') return false
  return undefined
}

/** Normalize `/api/health` -> `youmiAi` for client state (supports nested `capabilities`). */
export function hostedHealthFromApiJson(j: unknown): HostedHealthSnapshot | null {
  if (!j || typeof j !== 'object') return null
  const root = j as { youmiAi?: Record<string, unknown> }
  const ya = root.youmiAi
  if (!ya || typeof ya !== 'object') return null
  const pr = ya.providerReadiness as HostedHealthSnapshot['providerReadiness'] | undefined
  const product = ya.product as HostedHealthSnapshot['product'] | undefined
  const caps = ya.capabilities as Record<string, unknown> | undefined
  const live =
    parseOptionalBool(ya.liveCaptions) ?? parseOptionalBool(caps?.liveCaptions)
  const postClass =
    parseOptionalBool(ya.postClassTranscript) ??
    (caps ? parseOptionalBool(caps.postClassTranscript) : undefined) ??
    (caps ? Boolean(caps.transcribe && caps.summarize) : undefined)
  const ready = Boolean(ya.ready)
  /**
   * Current server gates `ready` and `liveCaptions` on the same keys (DashScope / OpenAI). If a proxy or older
   * payload omits `liveCaptions` but `ready` is true, treat live captions as available; otherwise the UI
   * falsely shows "not available" while after-class ASR works.
   */
  const liveCaptionsResolved = live ?? (ready ? true : undefined)
  return {
    ready,
    postClassTranscript: postClass,
    liveCaptions: liveCaptionsResolved,
    product,
    providerReadiness: pr,
    mode: ya.mode as HostedHealthSnapshot['mode'],
  }
}

export function isHostedAiConfigured(health: HostedHealthSnapshot | null): boolean {
  return Boolean(health?.ready)
}

/** Hosted live caption chunks: stub mode or explicit `liveCaptions` capability from `/api/health`. */
export function isHostedLiveCaptionsPipelineReady(health: HostedHealthSnapshot | null): boolean {
  if (!health) return false
  if (isStubAiEnabled(health)) return true
  if (health.liveCaptions === false) return false
  if (health.liveCaptions === true) return true
  /** Legacy payloads omitted `liveCaptions`; same backend keys as `ready` on current server. */
  return health.ready === true
}

export function isStubAiEnabled(health: HostedHealthSnapshot | null): boolean {
  return Boolean(
    health?.mode?.stubAiEnabled || health?.mode?.hostedRuntimeMode === 'stub',
  )
}

export function isByokEnabled(): boolean {
  return getAiSource() === 'byok'
}

export function isDeveloperMode(): boolean {
  return isDeveloperAiMode()
}
