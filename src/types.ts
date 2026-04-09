export type RecordingStatus = 'idle' | 'recording' | 'paused'

/**
 * Phase 2 (reserved): async worker job states on `recordings.ai_status`.
 * The default web app does not advance these from the browser; only inserts seed `pending`.
 */
export type AiJobStatus = 'pending' | 'queued' | 'transcribing' | 'summarizing' | 'done' | 'failed'

export interface Recording {
  id: string
  course: string
  title: string
  createdAt: number
  durationSec: number
  mime: string
  transcript?: string
  summaryEn?: string
  summaryZh?: string
  liveTranscript?: string
  aiStatus?: AiJobStatus
  aiError?: string
  aiUpdatedAt?: number
}

export interface RecordingDetail extends Recording {
  audioUrl: string
  storagePath: string
}
