import type { AiUiOutcome, SaveUiOutcome } from './recordingFlow'

/** Persists after control flow returns to idle; cleared on new save attempt or Dismiss. */
export type RecentCaptureOutcome =
  | null
  | {
      kind: 'success'
      recordingId: string
      at: number
    }
  | {
      kind: 'list_refresh_warn'
      recordingId: string
      message: string
      at: number
    }
  | {
      kind: 'failure'
      recordingId: string | null
      outcome: SaveUiOutcome
      message: string
      at: number
    }

/** AI pipeline results; recording row is already safe when kind is *_failed. */
export type RecentAiOutcome =
  | null
  | {
      kind: 'transcribe_failed'
      recordingId: string
      message: string
      at: number
    }
  | {
      kind: 'summarize_failed'
      recordingId: string
      message: string
      at: number
    }
  | {
      kind: 'persist_failed'
      recordingId: string
      message: string
      at: number
    }
  | {
      kind: 'other'
      recordingId: string
      message: string
      at: number
    }
  | {
      kind: 'success'
      recordingId: string
      at: number
    }

export function aiOutcomeToRecent(
  outcome: AiUiOutcome,
  recordingId: string,
  message: string,
): RecentAiOutcome {
  const at = Date.now()
  switch (outcome) {
    case 'transcribe_failed':
      return { kind: 'transcribe_failed', recordingId, message, at }
    case 'summarize_failed':
      return { kind: 'summarize_failed', recordingId, message, at }
    case 'persist_failed':
      return { kind: 'persist_failed', recordingId, message, at }
    default:
      return { kind: 'other', recordingId, message, at }
  }
}
