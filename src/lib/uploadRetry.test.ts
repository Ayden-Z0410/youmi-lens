import { describe, expect, it } from 'vitest'
import {
  isTransientUploadError,
  computeUploadRetryPlan,
  UPLOAD_MAX_ATTEMPTS,
} from './uploadRetry'

describe('upload retry policy (Phase 2D-1)', () => {
  it('retries transient network/timeout/gateway errors', () => {
    for (const m of ['network error', 'fetch failed', 'Failed to fetch', 'Audio upload timed out', 'ECONNRESET', '502 Bad Gateway', '503', '504 gateway timeout', 'Too Many Requests 429']) {
      expect(isTransientUploadError(new Error(m))).toBe(true)
    }
  })

  it('never retries non-transient outcomes (would waste time or duplicate risk)', () => {
    expect(isTransientUploadError(new Error('recording_too_long'))).toBe(false)
    expect(isTransientUploadError(new Error('Bucket not found'))).toBe(false)
    expect(isTransientUploadError(new Error('IAP not configured'))).toBe(false)
    expect(isTransientUploadError(new Error('forbidden'))).toBe(false)
  })

  it('never retries a definite server-side DB failure (audio already stored)', () => {
    const dbErr = Object.assign(new Error('Database save failed'), {
      name: 'SaveRecordingRemoteError',
      phase: 'database_insert',
    })
    expect(isTransientUploadError(dbErr)).toBe(false)
  })

  it('bounded backoff: retries up to the max, then stops', () => {
    expect(computeUploadRetryPlan(1)).toEqual({ retry: true, delayMs: 600 })
    expect(computeUploadRetryPlan(2)).toEqual({ retry: true, delayMs: 1200 })
    expect(computeUploadRetryPlan(UPLOAD_MAX_ATTEMPTS)).toEqual({ retry: false, delayMs: 0 })
    // delay is always bounded
    for (let a = 1; a < UPLOAD_MAX_ATTEMPTS; a++) {
      expect(computeUploadRetryPlan(a).delayMs).toBeLessThanOrEqual(1500)
    }
  })

  it('exposes a small, safe attempt cap', () => {
    expect(UPLOAD_MAX_ATTEMPTS).toBeGreaterThanOrEqual(2)
    expect(UPLOAD_MAX_ATTEMPTS).toBeLessThanOrEqual(4)
  })
})
