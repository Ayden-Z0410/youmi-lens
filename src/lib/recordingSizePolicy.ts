/**
 * Recording save-size policy (Phase 2D — long-recording reliability).
 *
 * Evidence-based invariant established by auditing the pipeline:
 *   • The full recording is persisted to durable storage before any transcription.
 *     - Cloud: POST /api/upload-audio → Supabase Storage (server cap 500 MB,
 *       server/uploadAudio.mjs MAX_UPLOAD_BYTES) then a `recordings` row with
 *       ai_status='pending'.
 *     - Local: saveRecordingLocal(...) into browser storage.
 *   • Transcription is a SEPARATE, asynchronous step: Paraformer reads the audio
 *     from a signed Storage URL (`transcribeAudioFromUrl`, file_urls: [url]) — it
 *     has NO 25 MB per-file limit and handles hour-long lectures.
 *
 * Therefore the client must NEVER reject a recording by size before persisting it.
 * The 25 MB limit is specific to the OpenAI **Whisper (BYOK)** transcription
 * provider and is a post-persistence transcription concern only — it must not gate
 * (let alone discard) the recording. The old `blob.size > MAX_WHISPER_BYTES` guard
 * violated this and lost ~20 min / ~57 MB lectures.
 */

/** OpenAI Whisper per-file limit (BYOK transcription provider only). */
export const WHISPER_PROVIDER_MAX_BYTES = 25 * 1024 * 1024

/** Durable upload cap enforced by the desktop server proxy (server/uploadAudio.mjs). */
export const SERVER_UPLOAD_MAX_BYTES = 500 * 1024 * 1024

export type RecordingPersistPlan = {
  /** Always true: every recording is persisted; size never blocks the save. */
  persist: true
  /** Primary durable target for the user's mode. */
  via: 'cloud' | 'local'
  /** Whether the file fits the durable upload path (cloud). */
  fitsDurableUpload: boolean
  /**
   * Informational only: whether the BYOK OpenAI Whisper provider could transcribe
   * this file in one shot. When false, the hosted Paraformer path (no limit) is
   * used; the audio is persisted regardless, so this NEVER blocks saving.
   */
  whisperOneShotOk: boolean
}

/**
 * Decide how to persist a just-captured recording. Size is never a reason to
 * reject — only to choose/annotate the path. Returns `persist: true` for any
 * finite positive byte count, including recordings far larger than 25 MB.
 */
export function planRecordingPersist(bytes: number, opts: { localOnly: boolean }): RecordingPersistPlan {
  return {
    persist: true,
    via: opts.localOnly ? 'local' : 'cloud',
    fitsDurableUpload: fitsDurableUpload(bytes),
    whisperOneShotOk: !exceedsWhisperProviderLimit(bytes),
  }
}

/** The full recording fits the durable server upload path (≤ 500 MB). */
export function fitsDurableUpload(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes > 0 && bytes <= SERVER_UPLOAD_MAX_BYTES
}

/** Only relevant to the BYOK OpenAI Whisper step, applied AFTER persistence. */
export function exceedsWhisperProviderLimit(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes > WHISPER_PROVIDER_MAX_BYTES
}
