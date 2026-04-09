import { describe, expect, it } from 'vitest'
import { nextRecentCaptureForNewSave } from './recentCapturePolicy'

describe('nextRecentCaptureForNewSave', () => {
  it('clears when there was no prior banner', () => {
    expect(nextRecentCaptureForNewSave(null)).toBeNull()
  })

  it('clears when prior outcome was success (next save starts fresh)', () => {
    expect(
      nextRecentCaptureForNewSave({
        kind: 'success',
        recordingId: 'a',
        at: 1,
      }),
    ).toBeNull()
  })

  it('keeps list_refresh_warn until user dismisses', () => {
    const prev = {
      kind: 'list_refresh_warn' as const,
      recordingId: 'b',
      message: 'm',
      at: 2,
    }
    expect(nextRecentCaptureForNewSave(prev)).toBe(prev)
  })

  it('keeps failure until user dismisses', () => {
    const prev = {
      kind: 'failure' as const,
      recordingId: 'c',
      outcome: 'storage_failed' as const,
      message: 'err',
      at: 3,
    }
    expect(nextRecentCaptureForNewSave(prev)).toBe(prev)
  })
})
