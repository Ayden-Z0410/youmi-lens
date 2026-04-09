/**
 * User-facing copy for AI features. No model vendors, keys, or engine names in strings returned here.
 *
 * Architecture note (for maintainers):
 * - Production builds should use the hosted backend (`useAiBackend === true`); users never supply credentials.
 * - Development may use `VITE_USE_AI_BACKEND` + local server, or a local key via Developer settings only.
 */

import type { AiJobStatus } from '../types'
import { isProductAiMode } from './productAi'

/** Status line for cloud hosted jobs (polls `recordings.ai_status`). */
export function hostedRecordingAiStatusLabel(status: AiJobStatus | undefined): string | null {
  switch (status) {
    case 'pending':
      return null
    case 'queued':
      return 'Youmi AI is starting…'
    case 'transcribing':
      return 'Youmi AI is transcribing…'
    case 'summarizing':
      return 'Youmi AI is writing bilingual summaries…'
    case 'done':
    case 'failed':
    default:
      return null
  }
}

/** Collapse vendor-specific or technical backend errors — never echo model/vendor names in UI. */
export function userFacingHostedJobFailure(raw?: string | null): string {
  const fallback = 'Youmi AI is temporarily unavailable. Try again later.'
  if (!raw || raw.length > 400) return fallback
  if (
    /openai|api\.openai|qwen|dashscope|deepseek|anthropic|claude|gpt-|whisper|paraformer|sk-|401|429|quota|insufficient|aliyun|alibaba/i.test(
      raw,
    )
  ) {
    return fallback
  }
  return raw
}

export function liveCaptionBlockedMessage(
  useAiBackend: boolean,
  showDevPanel: boolean,
  hasLocalCredential: boolean,
): string {
  if (useAiBackend) {
    return 'Live captions could not start with Youmi AI. Check your connection and try again.'
  }
  if (
    import.meta.env.DEV &&
    !isProductAiMode() &&
    showDevPanel &&
    !hasLocalCredential
  ) {
    return 'Live captions need a local AI setup for this development build. Open Advanced setup in Session below, or enable your server proxy in .env.'
  }
  return 'Live captions are not available with Youmi AI right now. Please try again.'
}

export function transcribeNeedsSetupMessage(
  useAiBackend: boolean,
  showDevPanel: boolean,
  hasLocalCredential: boolean,
): string {
  if (useAiBackend) return 'Youmi AI could not start. Check your connection and try again.'
  if (
    import.meta.env.DEV &&
    !isProductAiMode() &&
    showDevPanel &&
    !hasLocalCredential
  ) {
    return 'Transcription needs a local AI setup for this development build. Use Advanced setup in Session below, or enable the server proxy.'
  }
  return 'Youmi AI is not ready. Please try again in a moment.'
}

export function recordingTooLargeUserMessage(mb: string): string {
  return `This recording is about ${mb} MB. For now, shorter sessions (under about 25 MB) work best. Try a shorter clip or lower recording quality.`
}

/** Collapse technical failures to a safe line for the product UI (detail still in console from caller). */
export function userFacingTranscribeFailure(): string {
  return 'Transcription did not finish. Your recording was not changed. Try again in a moment.'
}

export function userFacingSummarizeFailure(): string {
  return 'Summaries did not finish. If a transcript was saved, you can try again shortly.'
}

export function userFacingGenericProcessingFailure(): string {
  return 'Something went wrong while processing this lecture. Your audio is usually still saved - try again later.'
}
