import { describe, expect, it } from 'vitest'
import {
  SPEECH_AUDIO_BITS_PER_SECOND,
  SPEECH_BITRATE_CANDIDATES_BPS,
  buildMediaRecorderOptions,
  expectedRecordingBytes,
  expectedRecordingMib,
  selectSpeechBitrateBps,
} from './recordingBitrate'
import { SERVER_UPLOAD_MAX_BYTES } from './recordingSizePolicy'

describe('recordingBitrate (Phase 2D-4)', () => {
  it('selects 64 kbps by default for classroom speech', () => {
    expect(selectSpeechBitrateBps()).toBe(64_000)
    expect(SPEECH_AUDIO_BITS_PER_SECOND).toBe(64_000)
    expect(SPEECH_BITRATE_CANDIDATES_BPS).toEqual([48_000, 64_000, 96_000])
  })

  it('allows only evaluated candidate overrides', () => {
    expect(selectSpeechBitrateBps(96_000)).toBe(96_000)
    expect(selectSpeechBitrateBps(48_000)).toBe(48_000)
    expect(selectSpeechBitrateBps(128_000)).toBe(64_000)
    expect(selectSpeechBitrateBps(NaN)).toBe(64_000)
  })

  it('computes expected sizes for 60 / 90 / 120 minutes at 64 kbps', () => {
    expect(expectedRecordingBytes(60 * 60)).toBe(28_800_000)
    expect(expectedRecordingBytes(90 * 60)).toBe(43_200_000)
    expect(expectedRecordingBytes(120 * 60)).toBe(57_600_000)
    // Binary MiB (~27.5 / ~41.2 / ~54.9)
    expect(expectedRecordingMib(60 * 60)).toBeCloseTo(27.47, 1)
    expect(expectedRecordingMib(90 * 60)).toBeCloseTo(41.2, 1)
    expect(expectedRecordingMib(120 * 60)).toBeCloseTo(54.93, 1)
  })

  it('keeps two-hour expected size well under the durable upload cap', () => {
    const twoHour = expectedRecordingBytes(120 * 60)
    expect(twoHour).toBeLessThan(SERVER_UPLOAD_MAX_BYTES)
    expect(twoHour).toBeLessThan(100 * 1024 * 1024)
  })

  it('builds MediaRecorder options with explicit audioBitsPerSecond (WebKit may ignore)', () => {
    const withMime = buildMediaRecorderOptions('audio/webm;codecs=opus')
    expect(withMime.audioBitsPerSecond).toBe(64_000)
    expect(withMime.mimeType).toBe('audio/webm;codecs=opus')
    const noMime = buildMediaRecorderOptions('')
    expect(noMime.audioBitsPerSecond).toBe(64_000)
    expect(noMime.mimeType).toBeUndefined()
  })

  it('returns 0 for invalid duration/bitrate', () => {
    expect(expectedRecordingBytes(0)).toBe(0)
    expect(expectedRecordingBytes(-1)).toBe(0)
    expect(expectedRecordingBytes(60, 0)).toBe(0)
  })
})
