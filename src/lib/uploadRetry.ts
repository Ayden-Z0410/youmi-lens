/**
 * Bounded, idempotent retry policy for the cloud audio upload (Phase 2D-1).
 *
 * The full-recording upload targets a STABLE storage path per recording UUID and
 * an idempotent DB insert (insertLectureRecordingRow → 'already_exists'), so
 * re-attempting the same upload can NEVER create a duplicate lecture or duplicate
 * storage object. That makes it safe to auto-retry a transient interruption
 * (network blip, timeout, gateway 5xx) a few times before surfacing a failure.
 *
 * We deliberately do NOT retry non-transient outcomes:
 *   - recording_too_long (quota/duration rejection — handled by local fallback),
 *   - a definite server-side database failure (SaveRecordingRemoteError, phase
 *     'database_insert' — the audio is already stored; re-uploading won't help),
 *   - "bucket not found" / configuration errors.
 */

export const UPLOAD_MAX_ATTEMPTS = 3

/** True if the error looks like a transient upload/network condition worth retrying. */
export function isTransientUploadError(err: unknown): boolean {
  const anyErr = err as { phase?: string; name?: string; message?: string } | null | undefined
  // Definite server-side DB outcome: audio already stored, retrying upload is pointless.
  if (anyErr?.name === 'SaveRecordingRemoteError' && anyErr?.phase === 'database_insert') return false
  const msg = (anyErr?.message ?? String(err ?? '')).toLowerCase()
  // Non-transient categories — never retry these.
  if (/recording_too_long|too long/.test(msg)) return false
  if (/bucket not found/.test(msg)) return false
  if (/not configured|permission|unauthor|forbidden|invalid storage path/.test(msg)) return false
  // Transient categories — worth a bounded retry.
  return /network|fetch failed|failed to fetch|timeout|timed out|econn|socket|temporarily|gateway|502|503|504|too many requests|429/.test(
    msg,
  )
}

export type UploadRetryPlan = { retry: boolean; delayMs: number }

/**
 * Given the just-finished attempt number (1-based) and a max, decide whether to
 * retry and how long to wait (bounded exponential backoff: ~600ms, 1500ms).
 */
export function computeUploadRetryPlan(
  attempt: number,
  maxAttempts: number = UPLOAD_MAX_ATTEMPTS,
): UploadRetryPlan {
  if (attempt >= maxAttempts) return { retry: false, delayMs: 0 }
  const delayMs = Math.min(1500, 600 * attempt)
  return { retry: true, delayMs }
}
