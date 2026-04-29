export type RecordingStatus = 'idle' | 'recording' | 'paused'

/**
 * Phase 2 (reserved): async worker job states on `recordings.ai_status`.
 * The default web app does not advance these from the browser; only inserts seed `pending`.
 */
export type AiJobStatus =
  | 'pending'
  | 'queued'
  | 'transcribing'
  | 'summarizing'
  | 'transcript_ready'
  | 'done'
  | 'failed'

export interface Recording {
  id: string
  course: string
  title: string
  createdAt: number
  durationSec: number
  mime: string
  /** Canonical text (normalized); summaries and primary UI use this. */
  transcript?: string
  /** Raw ASR/browser transcription before canonicalization. */
  transcriptRaw?: string
  summaryEn?: string
  summaryZh?: string
  /** Canonical in-class caption text. */
  liveTranscript?: string
  /** Assembled live caption stream before canonicalization. */
  liveTranscriptRaw?: string
  aiStatus?: AiJobStatus
  aiError?: string
  aiUpdatedAt?: number
  /** After-class job: transcript row is safe to show. */
  transcriptReady?: boolean
  /** Bilingual summaries completed. */
  summaryReady?: boolean
  /** Chinese summary text available (hosted path aligns with summary_zh). */
  translationReady?: boolean
  /** Server-only pipeline timing (ms since job start). */
  aiPipelineTiming?: {
    transcript_ready_ms?: number
    summary_ready_ms?: number
  }
}

export interface RecordingDetail extends Recording {
  audioUrl: string
  storagePath: string
}
