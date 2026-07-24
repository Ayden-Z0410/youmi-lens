/**
 * Speech-oriented MediaRecorder bitrate policy (Phase 2D-4).
 *
 * Classroom lectures: clear speech + moderate room noise at lecturer distance.
 * Prefer the smallest Opus bitrate that remains reliable for transcription.
 *
 * Chosen default: 64 kbps Opus — good speech intelligibility without the
 * ~2.8 MB/min bloat seen when WebKit/Chromium pick an unconstrained default
 * (~57 MB for ~20 min in the prior incident).
 *
 * WebKit may ignore audioBitsPerSecond; callers must still set it when supported
 * and tolerate browser-default size when it is ignored.
 */

/** Speech bitrate candidates evaluated for classroom capture (bps). */
export const SPEECH_BITRATE_CANDIDATES_BPS = [48_000, 64_000, 96_000] as const

/** Selected classroom speech bitrate (Opus). Prefer 64 kbps unless evidence requires 96. */
export const SPEECH_AUDIO_BITS_PER_SECOND = 64_000

/** Bytes ≈ bitrate_bps * seconds / 8 (container overhead ignored; good enough for planning). */
export function expectedRecordingBytes(
  durationSec: number,
  bitsPerSecond: number = SPEECH_AUDIO_BITS_PER_SECOND,
): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0
  if (!Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) return 0
  return Math.round((bitsPerSecond * durationSec) / 8)
}

/** Human-oriented MiB (binary) for UI/tests — not a size gate. */
export function expectedRecordingMib(
  durationSec: number,
  bitsPerSecond: number = SPEECH_AUDIO_BITS_PER_SECOND,
): number {
  return expectedRecordingBytes(durationSec, bitsPerSecond) / (1024 * 1024)
}

/**
 * Select the speech bitrate. Always returns 64 kbps unless an explicit override
 * is provided and is one of the evaluated candidates.
 */
export function selectSpeechBitrateBps(overrideBps?: number): number {
  if (
    typeof overrideBps === 'number' &&
    (SPEECH_BITRATE_CANDIDATES_BPS as readonly number[]).includes(overrideBps)
  ) {
    return overrideBps
  }
  return SPEECH_AUDIO_BITS_PER_SECOND
}

/**
 * Build MediaRecorder options: mime when known + explicit audioBitsPerSecond.
 * Callers must still handle browsers that ignore the bitrate hint.
 */
export function buildMediaRecorderOptions(
  mime: string,
  bitsPerSecond: number = SPEECH_AUDIO_BITS_PER_SECOND,
): MediaRecorderOptions {
  const opts: MediaRecorderOptions = {
    audioBitsPerSecond: bitsPerSecond,
  }
  if (mime) opts.mimeType = mime
  return opts
}

/** True when a browser MediaRecorder constructor would accept our bitrate option shape. */
export function supportsAudioBitsPerSecondOption(): boolean {
  // Feature is part of the options dictionary; engines that ignore it still accept the key.
  // We cannot probe "honored" vs "accepted" without encoding — treat dictionary support as OK.
  return typeof MediaRecorder !== 'undefined'
}
