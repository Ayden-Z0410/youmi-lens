/**
 * AI client facade — re-exports unified execution + API base.
 * Prefer importing from `src/lib/ai/execute` or `src/lib/ai/apiBase` in new code.
 */

export { getAiApiBase } from './ai/apiBase'
export {
  transcribeRecording,
  summarizeRecording,
  translateLiveCaption,
  transcribeRecordingDirectOpenAI,
  summarizeRecordingDirectOpenAI,
  translateLiveCaptionDirectOpenAI,
  type LiveCaptionTranslateTarget,
} from './ai/execute'

/** Dev: opt-in backend unless product build. Prefer {@link usesYoumiHosted} from `./ai/aiSource`. */
export function defaultUseAiBackend(): boolean {
  if (import.meta.env.PROD) return true
  return import.meta.env.VITE_USE_AI_BACKEND === 'true'
}

/**
 * @deprecated Legacy dev panel; use Account → AI instead.
 */
export function showDevOpenAiKeyPanel(): boolean {
  return (
    import.meta.env.DEV === true &&
    import.meta.env.VITE_PRODUCT_AI_MODE !== 'true' &&
    import.meta.env.VITE_SHOW_DEV_AI_KEY !== 'false'
  )
}
