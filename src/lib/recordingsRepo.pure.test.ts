import { describe, expect, it } from 'vitest'
import {
  lectureRecordingInsertPayload,
  mapDbRowToRecording,
  parseAiJobStatus,
  type RecordingDbRow,
} from './recordingsRepo'

function baseRow(over: Partial<RecordingDbRow> = {}): RecordingDbRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    user_id: '00000000-0000-4000-8000-000000000002',
    course: 'c',
    title: 't',
    created_at: '2020-01-01T00:00:00.000Z',
    duration_sec: 60,
    mime: 'audio/webm',
    storage_path: 'u/00000000-0000-4000-8000-000000000001.webm',
    transcript: null,
    transcript_raw: null,
    summary_en: null,
    summary_zh: null,
    live_transcript: null,
    live_transcript_raw: null,
    ai_status: null,
    ai_error: null,
    ai_updated_at: null,
    ...over,
  }
}

describe('parseAiJobStatus', () => {
  it('maps null / undefined to pending (legacy-friendly)', () => {
    expect(parseAiJobStatus(null)).toBe('pending')
    expect(parseAiJobStatus(undefined)).toBe('pending')
  })

  it('accepts known worker states', () => {
    expect(parseAiJobStatus('done')).toBe('done')
    expect(parseAiJobStatus('failed')).toBe('failed')
  })
})

describe('mapDbRowToRecording', () => {
  it('handles all ai_* null without throwing', () => {
    const r = mapDbRowToRecording(baseRow())
    expect(r.aiStatus).toBe('pending')
    expect(r.aiError).toBeUndefined()
    expect(r.aiUpdatedAt).toBeUndefined()
    expect(r.title).toBe('t')
  })

  it('maps populated ai fields', () => {
    const r = mapDbRowToRecording(
      baseRow({
        ai_status: 'done',
        ai_error: 'x',
        ai_updated_at: '2021-06-15T12:00:00.000Z',
      }),
    )
    expect(r.aiStatus).toBe('done')
    expect(r.aiError).toBe('x')
    expect(r.aiUpdatedAt).toBe(new Date('2021-06-15T12:00:00.000Z').getTime())
  })
})

describe('lectureRecordingInsertPayload', () => {
  it('seeds ai_status pending for new cloud rows', () => {
    const p = lectureRecordingInsertPayload({
      id: 'i',
      userId: 'u',
      course: 'c',
      title: 't',
      durationSec: 1,
      mime: 'audio/webm',
      storagePath: 'p',
      liveTranscript: '',
      liveTranscriptRaw: '',
      nowIso: '2030-01-01T00:00:00.000Z',
    })
    expect(p.ai_status).toBe('pending')
    expect(p.ai_error).toBeNull()
    expect(p.ai_updated_at).toBe('2030-01-01T00:00:00.000Z')
  })
})
