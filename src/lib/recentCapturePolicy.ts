import type { RecentCaptureOutcome } from './recentOutcomes'

/**
 * When the user starts a new Stop & save, clear a prior **success** banner so the UI
 * reflects the new attempt. Keep `list_refresh_warn` and `failure` until the user dismisses.
 */
export function nextRecentCaptureForNewSave(
  prev: RecentCaptureOutcome,
): RecentCaptureOutcome | null {
  if (prev == null || prev.kind === 'success') return null
  return prev
}
