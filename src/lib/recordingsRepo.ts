import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiJobStatus, Recording, RecordingDetail } from '../types'

const BUCKET = 'lecture-audio'

export type SaveRecordingRemotePhase = 'storage_upload' | 'database_insert'

/** Thrown from {@link saveRecordingRemote} with a stable phase for UI messaging. */
export class SaveRecordingRemoteError extends Error {
  readonly phase: SaveRecordingRemotePhase

  constructor(phase: SaveRecordingRemotePhase, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'SaveRecordingRemoteError'
    this.phase = phase
  }
}

function describeUnknown(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return String(err)
}

/** Shape of `public.recordings` rows from Supabase. */
export type RecordingDbRow = {
  id: string
  user_id: string
  course: string
  title: string
  created_at: string
  duration_sec: number
  mime: string
  storage_path: string
  transcript: string | null
  transcript_raw: string | null
  summary_en: string | null
  summary_zh: string | null
  live_transcript: string | null
  live_transcript_raw: string | null
  ai_status: string | null
  ai_error: string | null
  ai_updated_at: string | null
}

const AI_STATUSES: AiJobStatus[] = [
  'pending',
  'queued',
  'transcribing',
  'summarizing',
  'done',
  'failed',
]

/** Unknown / null `ai_status` (e.g. legacy rows) maps to `pending` so the UI stays usable. */
export function parseAiJobStatus(raw: string | null | undefined): AiJobStatus {
  if (raw && (AI_STATUSES as string[]).includes(raw)) return raw as AiJobStatus
  return 'pending'
}

export function mapDbRowToRecording(r: RecordingDbRow): Recording {
  return {
    id: r.id,
    course: r.course,
    title: r.title,
    createdAt: new Date(r.created_at).getTime(),
    durationSec: r.duration_sec,
    mime: r.mime,
    transcript: r.transcript ?? undefined,
    transcriptRaw: r.transcript_raw ?? undefined,
    summaryEn: r.summary_en ?? undefined,
    summaryZh: r.summary_zh ?? undefined,
    liveTranscript: r.live_transcript ?? undefined,
    liveTranscriptRaw: r.live_transcript_raw ?? undefined,
    aiStatus: parseAiJobStatus(r.ai_status),
    aiError: r.ai_error ?? undefined,
    aiUpdatedAt: r.ai_updated_at ? new Date(r.ai_updated_at).getTime() : undefined,
  }
}

export async function listRecordings(
  supabase: SupabaseClient,
  userId: string,
): Promise<Recording[]> {
  const { data, error } = await supabase
    .from('recordings')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data as RecordingDbRow[]).map(mapDbRowToRecording)
}

export async function getRecordingDetail(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<RecordingDetail | null> {
  const { data, error } = await supabase
    .from('recordings')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as RecordingDbRow
  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, 3600)

  if (signErr || !signed?.signedUrl) throw signErr ?? new Error('Could not sign audio URL')

  return {
    ...mapDbRowToRecording(row),
    audioUrl: signed.signedUrl,
    storagePath: row.storage_path,
  }
}

export async function downloadRecordingBlob(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<Blob> {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath)
  if (error || !data) throw error ?? new Error('Download failed')
  return data
}

function extensionForMime(mime: string): string {
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('mp4')) return 'm4a'
  return 'bin'
}

/** Stable path per recording UUID enables idempotent re-upload (retries / same client_request_id). */
export function lectureAudioStoragePath(userId: string, recordingId: string, mime: string): string {
  return `${userId}/${recordingId}.${extensionForMime(mime)}`
}

/** DB row only (no Storage signing). Use to verify persistence without treating signing errors as "not saved". */
export async function getRecordingMeta(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<{ id: string; storage_path: string; title: string } | null> {
  const { data, error } = await supabase
    .from('recordings')
    .select('id, storage_path, title')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  const row = data as { id: string; storage_path: string; title: string }
  return row
}

export async function uploadLectureAudio(
  supabase: SupabaseClient,
  path: string,
  blob: Blob,
  mime: string,
): Promise<void> {
  const tail = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path
  console.warn(
    '[MainRec][upload]',
    JSON.stringify({
      storageObjectTail: tail,
      clientBlobBytes: blob.size,
      mime: mime || 'audio/webm',
      t: Date.now(),
    }),
  )
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: mime || 'audio/webm',
    upsert: true,
  })
  if (upErr) {
    throw new SaveRecordingRemoteError(
      'storage_upload',
      `Audio upload failed: ${describeUnknown(upErr)}`,
      { cause: upErr },
    )
  }
  console.warn('[MainRec][upload_ok]', JSON.stringify({ storageObjectTail: tail, t: Date.now() }))
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '23505'
  )
}

/** Payload for `recordings.insert` on cloud save. Sets Phase-2-reserved job columns (worker will advance them). */
export function lectureRecordingInsertPayload(input: {
  id: string
  userId: string
  course: string
  title: string
  durationSec: number
  mime: string
  storagePath: string
  /** Canonical live caption (display + downstream). */
  liveTranscript: string
  /** Raw assembled live text before canonicalization. */
  liveTranscriptRaw: string
  /** @internal fixed clock for tests */
  nowIso?: string
}) {
  const nowIso = input.nowIso ?? new Date().toISOString()
  return {
    id: input.id,
    user_id: input.userId,
    course: input.course,
    title: input.title,
    duration_sec: input.durationSec,
    mime: input.mime,
    storage_path: input.storagePath,
    live_transcript: input.liveTranscript || null,
    live_transcript_raw: input.liveTranscriptRaw || null,
    ai_status: 'pending' as const,
    ai_error: null,
    ai_updated_at: nowIso,
  }
}

/**
 * Inserts row; if this client_request_id (recording id) already exists for the user, treats as idempotent success.
 * Returns whether a new row was inserted.
 */
export async function insertLectureRecordingRow(input: {
  supabase: SupabaseClient
  userId: string
  id: string
  course: string
  title: string
  durationSec: number
  mime: string
  storagePath: string
  liveTranscript: string
  liveTranscriptRaw: string
}): Promise<'inserted' | 'already_exists'> {
  const { error: insErr } = await input.supabase
    .from('recordings')
    .insert(
      lectureRecordingInsertPayload({
        id: input.id,
        userId: input.userId,
        course: input.course,
        title: input.title,
        durationSec: input.durationSec,
        mime: input.mime,
        storagePath: input.storagePath,
        liveTranscript: input.liveTranscript,
        liveTranscriptRaw: input.liveTranscriptRaw,
      }),
    )

  if (!insErr) return 'inserted'

  if (isUniqueViolation(insErr)) {
    const meta = await getRecordingMeta(input.supabase, input.userId, input.id)
    if (meta && meta.storage_path === input.storagePath) {
      return 'already_exists'
    }
    if (meta) {
      throw new SaveRecordingRemoteError(
        'database_insert',
        'This recording ID already exists with different data. Try saving as a new recording.',
        { cause: insErr },
      )
    }
    throw new SaveRecordingRemoteError(
      'database_insert',
      `Database save failed: ${describeUnknown(insErr)}`,
      { cause: insErr },
    )
  }

  const { error: rmErr } = await input.supabase.storage.from(BUCKET).remove([input.storagePath])
  if (rmErr) {
    console.warn('insertLectureRecordingRow: could not remove orphan upload after DB failure', rmErr)
  }
  throw new SaveRecordingRemoteError(
    'database_insert',
    `Database save failed: ${describeUnknown(insErr)}`,
    { cause: insErr },
  )
}

/** @deprecated Prefer {@link uploadLectureAudio} + {@link insertLectureRecordingRow} for phased saves. */
export async function saveRecordingRemote(input: {
  supabase: SupabaseClient
  userId: string
  id: string
  course: string
  title: string
  durationSec: number
  mime: string
  blob: Blob
  liveTranscript: string
  liveTranscriptRaw: string
}): Promise<void> {
  const path = lectureAudioStoragePath(input.userId, input.id, input.mime)
  await uploadLectureAudio(input.supabase, path, input.blob, input.mime)
  await insertLectureRecordingRow({
    supabase: input.supabase,
    userId: input.userId,
    id: input.id,
    course: input.course,
    title: input.title,
    durationSec: input.durationSec,
    mime: input.mime,
    storagePath: path,
    liveTranscript: input.liveTranscript,
    liveTranscriptRaw: input.liveTranscriptRaw,
  })
}

/**
 * Persists transcript / summaries from the **browser** Whisper flow only.
 * Does not update `ai_status` / `ai_error` / `ai_updated_at` (Phase 2: reserved for async workers).
 */
export async function updateRecordingAi(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  patch: {
    transcript?: string
    transcriptRaw?: string
    summaryEn?: string
    summaryZh?: string
  },
): Promise<void> {
  const payload: Record<string, string | undefined> = {}
  if (patch.transcript !== undefined) payload.transcript = patch.transcript
  if (patch.transcriptRaw !== undefined) payload.transcript_raw = patch.transcriptRaw
  if (patch.summaryEn !== undefined) payload.summary_en = patch.summaryEn
  if (patch.summaryZh !== undefined) payload.summary_zh = patch.summaryZh

  const { error } = await supabase
    .from('recordings')
    .update(payload)
    .eq('id', id)
    .eq('user_id', userId)

  if (error) throw error
}

export async function deleteRecordingRemote(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  storagePath: string,
): Promise<void> {
  const { error: stErr } = await supabase.storage.from(BUCKET).remove([storagePath])
  if (stErr) throw stErr

  const { error } = await supabase.from('recordings').delete().eq('id', id).eq('user_id', userId)
  if (error) throw error
}
