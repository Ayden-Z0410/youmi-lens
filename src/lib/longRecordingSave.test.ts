import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Phase 2D regression guard on the real save handler in src/App.tsx.
 * These assertions fail if anyone re-introduces a client-side size gate that
 * discards long recordings, or removes the upload-failure local fallback.
 */
const appSrc = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')

describe('long-recording save flow (src/App.tsx)', () => {
  it('does NOT reject/discard a recording by size before persisting it', () => {
    expect(appSrc).not.toContain('blob.size > MAX_WHISPER_BYTES')
    expect(appSrc).not.toMatch(/const MAX_WHISPER_BYTES\b/)
    // the destructive user message must no longer be wired into the save path
    expect(appSrc).not.toContain('recordingTooLargeUserMessage(')
  })

  it('persists audio on the primary paths (short + long recordings both save)', () => {
    // local-only save + cloud upload paths both remain present
    expect(appSrc).toContain('saveRecordingLocal({')
    expect(appSrc).toContain('uploadLectureAudioViaServer(')
  })

  it('preserves the audio locally when the cloud upload fails (Scenario C)', () => {
    // the storage-failure branch now falls back to a durable local save
    expect(appSrc).toContain("'Local save fallback (upload failed)'")
    expect(appSrc).toContain('upload_failed_preserved_locally')
  })

  it('keeps the existing recording_too_long → local fallback intact', () => {
    expect(appSrc).toContain('recording_too_long')
    expect(appSrc).toContain("'Local save fallback'")
  })

  it('documents the persist-first / no-size-gate invariant at the guard site', () => {
    expect(appSrc).toContain('NO client-side size gate')
  })
})
