import { describe, expect, it } from 'vitest'
import {
  planRecordingPersist,
  fitsDurableUpload,
  exceedsWhisperProviderLimit,
  WHISPER_PROVIDER_MAX_BYTES,
  SERVER_UPLOAD_MAX_BYTES,
} from './recordingSizePolicy'

const MB = 1024 * 1024
const SIZE_20MIN = Math.round(57.0 * MB) // the reported failing recording

describe('recording size policy (Phase 2D long-recording reliability)', () => {
  it('accepts the reported ~57MB / ~20min recording (no size rejection)', () => {
    const plan = planRecordingPersist(SIZE_20MIN, { localOnly: false })
    expect(plan.persist).toBe(true)
    expect(plan.via).toBe('cloud')
    expect(plan.fitsDurableUpload).toBe(true) // 57MB << 500MB server cap
  })

  it('never rejects by size — a 45–120 min lecture up to the 500MB cap still persists', () => {
    for (const mb of [5, 26, 57, 120, 250, 499]) {
      const plan = planRecordingPersist(mb * MB, { localOnly: false })
      expect(plan.persist).toBe(true)
      expect(plan.fitsDurableUpload).toBe(true)
    }
  })

  it('short recordings still work unchanged', () => {
    const plan = planRecordingPersist(4 * MB, { localOnly: false })
    expect(plan).toMatchObject({ persist: true, via: 'cloud', fitsDurableUpload: true, whisperOneShotOk: true })
  })

  it('local-only mode persists to local storage, size-agnostic', () => {
    const plan = planRecordingPersist(SIZE_20MIN, { localOnly: true })
    expect(plan).toMatchObject({ persist: true, via: 'local' })
  })

  it('the 25MB limit is a BYOK-Whisper transcription concern, not a save gate', () => {
    // A >25MB file is flagged as not one-shot-Whisper-able, but STILL persists.
    const plan = planRecordingPersist(SIZE_20MIN, { localOnly: false })
    expect(plan.whisperOneShotOk).toBe(false)
    expect(plan.persist).toBe(true) // <-- the fix: persistence is never blocked
    expect(exceedsWhisperProviderLimit(SIZE_20MIN)).toBe(true)
    expect(exceedsWhisperProviderLimit(10 * MB)).toBe(false)
  })

  it('durable upload cap (500MB server proxy) rejects only truly oversized files', () => {
    expect(fitsDurableUpload(499 * MB)).toBe(true)
    expect(fitsDurableUpload(SERVER_UPLOAD_MAX_BYTES)).toBe(true)
    expect(fitsDurableUpload(600 * MB)).toBe(false)
    expect(fitsDurableUpload(0)).toBe(false)
  })

  it('exposes the exact provider/server thresholds for reference', () => {
    expect(WHISPER_PROVIDER_MAX_BYTES).toBe(25 * MB)
    expect(SERVER_UPLOAD_MAX_BYTES).toBe(500 * MB)
  })
})
