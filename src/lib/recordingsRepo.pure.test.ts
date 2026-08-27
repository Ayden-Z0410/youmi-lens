import { readFileSync } from 'node:fs'
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
    expect(parseAiJobStatus('transcript_ready')).toBe('transcript_ready')
  })
})

describe('mapDbRowToRecording', () => {
  it('handles all ai_* null without throwing', () => {
    const r = mapDbRowToRecording(baseRow())
    expect(r.aiStatus).toBe('pending')
    expect(r.aiError).toBeUndefined()
    expect(r.aiUpdatedAt).toBeUndefined()
    expect(r.title).toBe('t')
    expect(r.storagePath).toBe('u/00000000-0000-4000-8000-000000000001.webm')
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

  it('persists the selected canonical Course UUID alongside the legacy label', () => {
    const p = lectureRecordingInsertPayload({
      id: 'i', userId: 'u', course: 'CS 250', courseId: 'course-uuid', title: 't',
      durationSec: 1, mime: 'audio/webm', storagePath: 'p', liveTranscript: '', liveTranscriptRaw: '',
    })
    expect(p).toMatchObject({ course: 'CS 250', course_id: 'course-uuid' })
  })
})

/**
 * Cloud audio resolution — must never depend on another device's local state.
 *
 * Verified live against staging in the Cloud Library acceptance pass: a
 * completely fresh client session (no local blob, no IndexedDB row, never the
 * device that recorded it) generated a working signed URL and downloaded the
 * exact bytes another session had uploaded. This pins the SOURCE property that
 * made that possible: `getRecordingDetail` resolves audio from the cloud row's
 * own `storage_path` alone.
 */
describe('cloud audio resolution is device-independent', () => {
  const source = readFileSync(new URL('./recordingsRepo.ts', import.meta.url), 'utf8')

  function body(name: string): string {
    const start = source.indexOf(`export async function ${name}(`)
    expect(start, name).toBeGreaterThan(-1)
    const next = source.indexOf('\nexport ', start + 1)
    return source.slice(start, next === -1 ? undefined : next)
  }

  it('getRecordingDetail signs audio from the ROW\'s own storage_path, not a local field', () => {
    const fn = body('getRecordingDetail')
    expect(fn).toContain('getRecordingAudioUrl(supabase, row.storage_path)')
    for (const local of ['localAudioUri', 'audioBlob', 'IndexedDB', 'indexedDB', 'objectUrl', 'ObjectURL']) {
      expect(fn, local).not.toContain(local)
    }
  })

  it('getRecordingAudioUrl takes storagePath as an explicit argument, not an ambient/local one', () => {
    const fn = body('getRecordingAudioUrl')
    expect(fn).toContain('supabase.storage')
    expect(fn).not.toContain('localAudioUri')
    expect(fn).not.toContain('IndexedDB')
  })

  it('the Supabase and userId scoping is the ONLY identity check — no device/session-local gate', () => {
    // The two `.eq(...)` calls are what RLS-style ownership scoping looks like
    // here; nothing about THIS device or a prior local recording is consulted.
    const fn = body('getRecordingDetail')
    expect(fn).toContain(".eq('id', id)")
    expect(fn).toContain(".eq('user_id', userId)")
  })
})
