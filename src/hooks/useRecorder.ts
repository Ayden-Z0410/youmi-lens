import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { logMediaEnvironmentOnce } from '../lib/mediaEnvDebug'
import type { RecordingStatus } from '../types'

/** Incident / P0: evidence chain for main lecture track only (no secrets). */
function mainRecLine(
  phase: 'start' | 'data' | 'stop' | 'blob' | 'guard' | 'flush',
  payload: Record<string, string | number | boolean | undefined | null>,
): void {
  console.warn(`[MainRec][${phase}]`, JSON.stringify({ ...payload, t: Date.now() }))
}

function pickMime(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ]
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c
  }
  return ''
}

/** Skip accidental tiny blobs from stop/pause races. */
const MIN_LIVE_AUDIO_BYTES = 2048

/** Live caption slice interval only (separate cloned MediaRecorder; does not use timeslice on main track). */
export const LIVE_WHISPER_SLICE_MS = 1600

/** After final requestData(), wait briefly so the encoder can append the last chunk before MediaRecorder.stop(). */
const MAIN_RECORDER_STOP_FLUSH_MS = 140

export function useRecorder(opts?: {
  /** Receives each timed audio slice while recording (cloned track; same mic as main file). */
  onLiveAudioChunkRef?: RefObject<((blob: Blob, mime: string) => void) | null>
  /**
   * PCM streaming path: receives raw Int16 PCM frames (~90ms each) from an AudioContext
   * ScriptProcessor. Used by the DashScope Paraformer real-time streaming ASR path.
   * When provided, the blob-slice MediaRecorder cycle should be disabled via experimentalSkipLiveSlice.
   */
  onPcmChunkRef?: RefObject<((buffer: ArrayBuffer, sampleRate: number) => void) | null>
  /**
   * Local A/B only: when true, do not clone the mic or run the live slice MediaRecorder cycle.
   * Main track is unchanged. Used to test whether the Youmi live chain interferes with main recording.
   */
  experimentalSkipLiveSlice?: boolean
}) {
  const [status, setStatus] = useState<RecordingStatus>('idle')
  const [elapsedSec, setElapsedSec] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const liveSliceRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const liveStreamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const mimeRef = useRef<string>('audio/webm')
  // PCM streaming capture (AudioContext path)
  const audioContextRef = useRef<AudioContext | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scriptProcessorRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const audioSourceRef = useRef<any>(null)
  /** One id per main MediaRecorder session — correlates [MainRec] lines in console. */
  const mainRecSessionIdRef = useRef<string>('')
  const mainDataChunkIndexRef = useRef(0)
  /** Force periodic flush so long sessions don't collapse to ~1s output. */
  const mainRequestDataTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const liveCyclingRef = useRef(false)
  const liveSliceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const liveSliceWaitRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startLiveSliceCycleRef = useRef<(() => void) | null>(null)
  const waitForHandlerAttemptsRef = useRef(0)

  useEffect(() => {
    if (status !== 'recording') return
    const id = window.setInterval(() => {
      setElapsedSec((s) => s + 1)
    }, 1000)
    return () => window.clearInterval(id)
  }, [status])

  /** Stop the current slice timer/recorder only (keep cycle fn so Resume can restart). */
  const haltLiveSliceCycle = useCallback(() => {
    liveCyclingRef.current = false
    if (liveSliceTimerRef.current) {
      clearTimeout(liveSliceTimerRef.current)
      liveSliceTimerRef.current = null
    }
    if (liveSliceWaitRef.current) {
      clearTimeout(liveSliceWaitRef.current)
      liveSliceWaitRef.current = null
    }
  }, [])

  const teardownLiveSliceCycle = useCallback(() => {
    haltLiveSliceCycle()
    startLiveSliceCycleRef.current = null
  }, [haltLiveSliceCycle])

  const teardownPcmCapture = useCallback(() => {
    try {
      audioSourceRef.current?.disconnect()
    } catch { /* ignore */ }
    try {
      scriptProcessorRef.current?.disconnect()
    } catch { /* ignore */ }
    audioSourceRef.current = null
    scriptProcessorRef.current = null
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => { /* ignore */ })
      audioContextRef.current = null
    }
  }, [])

  const stopStream = useCallback(() => {
    if (mainRequestDataTimerRef.current) {
      clearInterval(mainRequestDataTimerRef.current)
      mainRequestDataTimerRef.current = null
    }
    teardownPcmCapture()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    liveStreamRef.current?.getTracks().forEach((t) => t.stop())
    liveStreamRef.current = null
  }, [teardownPcmCapture])

  const start = useCallback(async () => {
    setError(null)
    try {
      const existing = mediaRecorderRef.current
      if (existing && existing.state !== 'inactive') {
        mainRecLine('guard', {
          reason: 'start_called_while_active',
          state: existing.state,
          session: mainRecSessionIdRef.current.slice(-8),
        })
        return
      }
      logMediaEnvironmentOnce()
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          'Microphone API unavailable (navigator.mediaDevices missing). On macOS desktop, rebuild the app after adding Info.plist (NSMicrophoneUsageDescription). See console [lc-media env].',
        )
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      streamRef.current = stream
      const mime = pickMime()
      mimeRef.current = mime || 'audio/webm'
      const mr = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      )
      mainRecSessionIdRef.current =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `main-${Date.now()}`
      mainDataChunkIndexRef.current = 0
      chunksRef.current = []
      const session = mainRecSessionIdRef.current
      mr.ondataavailable = (e) => {
        const ev = e as BlobEvent & { timecode?: number }
        const idx = mainDataChunkIndexRef.current++
        const tc = typeof ev.timecode === 'number' ? ev.timecode : undefined
        if (e.data.size > 0) chunksRef.current.push(e.data)
        const cumulativeBytes = chunksRef.current.reduce(
          (n, p) => n + (p instanceof Blob ? p.size : 0),
          0,
        )
        mainRecLine('data', {
          session: session.slice(-8),
          chunkIndex: idx,
          size: e.data.size,
          timecodeMs: tc,
          cumulativeBytes,
        })
      }
      /**
       * Full lecture file MUST be one continuous capture. Do not use a timeslice here: on several
       * browsers (notably WebKit) intermediate `dataavailable` blobs can be empty or invalid, and
       * filtering `size > 0` then leaves only the last slice — saved audio can be ~1s while the UI
       * timer shows the full session. Live captions use a separate cloned stream + their own MR.
       *
       * Commit `recording` status BEFORE `mr.start()` so parent useLayoutEffect attaches live chunk
       * handlers before any audio is captured (fixes first-session truncation vs second session OK).
       */
      flushSync(() => {
        setElapsedSec(0)
        setStatus('recording')
      })
      mr.start()
      mediaRecorderRef.current = mr
      mainRecLine('start', {
        session: session.slice(-8),
        mime: mr.mimeType || mime || '',
        recorderState: mr.state,
        audioTracks: stream.getAudioTracks().length,
        experimentalSkipLiveSlice: Boolean(opts?.experimentalSkipLiveSlice),
      })
      if (typeof mr.requestData === 'function') {
        if (mainRequestDataTimerRef.current) {
          clearInterval(mainRequestDataTimerRef.current)
        }
        // 5s is a good balance: frequent enough to avoid losing buffered media; not too chatty.
        mainRequestDataTimerRef.current = window.setInterval(() => {
          if (mr.state !== 'recording') return
          try {
            mr.requestData()
            mainRecLine('flush', { session: session.slice(-8), kind: 'periodic_requestData' })
          } catch {
            /* ignore */
          }
        }, 5000)
      }

      // PCM streaming capture via AudioContext ScriptProcessor.
      // Runs alongside the main MediaRecorder — does not affect the lecture recording.
      // Provides ~90ms Int16 PCM frames at the device sample rate for DashScope realtime ASR.
      const pcmChunkRef = opts?.onPcmChunkRef
      // Check the ref object exists (not .current) — .current is set by a useEffect that runs
      // after this recorder.start() call; reading it here would always be null.
      if (pcmChunkRef) {
        try {
          // Avoid TS complaining about AudioContext; cast through unknown
          const ACtx = (window.AudioContext ||
            (window as unknown as Record<string, unknown>).webkitAudioContext) as typeof AudioContext
          const ctx = new ACtx()
          audioContextRef.current = ctx
          const sampleRate = ctx.sampleRate

          const source = ctx.createMediaStreamSource(stream)
          audioSourceRef.current = source

          // 2048-sample buffer ≈ 43–46ms at 44.1–48kHz.
          // Smaller than 4096 so DashScope receives audio in shorter bursts, reducing
          // the silence gap at the start of a new session and improving first-word latency.
          // 2048 is the minimum Web Audio spec guarantees; 1024 can cause audio glitches.
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          const processor = ctx.createScriptProcessor(2048, 1, 1)
          scriptProcessorRef.current = processor

          processor.onaudioprocess = (event: AudioProcessingEvent) => {
            const send = pcmChunkRef.current
            if (!send) return
            const float32 = event.inputBuffer.getChannelData(0)
            const int16 = new Int16Array(float32.length)
            for (let i = 0; i < float32.length; i++) {
              const s = float32[i]
              int16[i] = s > 1 ? 32767 : s < -1 ? -32768 : Math.round(s * 32767)
            }
            // Transfer ownership to avoid copy
            send(int16.buffer, sampleRate)
          }

          // Route through a silent GainNode to keep the processor active without speaker output
          const silentGain = ctx.createGain()
          silentGain.gain.value = 0
          source.connect(processor)
          processor.connect(silentGain)
          silentGain.connect(ctx.destination)

          console.info('[useRecorder] PCM capture started', JSON.stringify({ sampleRate, bufferSize: 2048 }))
        } catch (pcmErr) {
          console.warn('[useRecorder] PCM capture setup failed', pcmErr)
          // Non-fatal: fall through; live captions unavailable in streaming mode
        }
      }

      const chunkRef = opts?.onLiveAudioChunkRef
      const runLiveSlice = Boolean(chunkRef) && !opts?.experimentalSkipLiveSlice
      if (chunkRef && opts?.experimentalSkipLiveSlice) {
        // In LiveEngine v2 mode, blob-slices are intentionally disabled; PCM streaming replaces them.
        // This is NOT triggered by VITE_EXPERIMENT_SKIP_YOUMI_LIVE_SLICE env var in v2 builds.
        console.info('[useRecorder] blob-slice disabled (v2 PCM streaming path is active)')
      }
      if (runLiveSlice && chunkRef) {
        const liveStream = stream.clone()
        liveStreamRef.current = liveStream
        const chunkRefNonNull = chunkRef

        const sliceOnce = () => {
          if (!liveCyclingRef.current || !liveStreamRef.current) return
          const send = chunkRefNonNull.current
          if (!send) {
            waitForHandlerAttemptsRef.current += 1
            if (waitForHandlerAttemptsRef.current > 100) {
              setError(
                'Live captions failed to start (handler not ready). Try Discard and Start again.',
              )
              liveCyclingRef.current = false
              return
            }
            liveSliceWaitRef.current = window.setTimeout(sliceOnce, 40)
            return
          }
          waitForHandlerAttemptsRef.current = 0

          const mimeType = mimeRef.current || pickMime()
          let rec: MediaRecorder
          try {
            rec = new MediaRecorder(
              liveStreamRef.current,
              mimeType ? { mimeType: mimeType } : undefined,
            )
          } catch {
            if (liveCyclingRef.current) {
              liveSliceWaitRef.current = window.setTimeout(sliceOnce, 100)
            }
            return
          }

          const parts: BlobPart[] = []
          rec.ondataavailable = (e) => {
            if (e.data.size > 0) parts.push(e.data)
          }
          rec.onstop = () => {
            const mt = rec.mimeType || mimeType || 'audio/webm'
            const blob = new Blob(parts, { type: mt })
            liveSliceRecorderRef.current = null
            if (blob.size >= MIN_LIVE_AUDIO_BYTES && liveCyclingRef.current) {
              console.info(
                '[LiveEngine][recorder] live chunk ready',
                JSON.stringify({ bytes: blob.size, mime: mt }),
              )
              send(blob, mt)
            }
            if (liveCyclingRef.current) {
              sliceOnce()
            }
          }

          liveSliceRecorderRef.current = rec
          rec.start()

          if (liveSliceTimerRef.current) clearTimeout(liveSliceTimerRef.current)
          liveSliceTimerRef.current = window.setTimeout(() => {
            liveSliceTimerRef.current = null
            if (rec.state === 'recording') {
              try {
                rec.stop()
              } catch {
                /* ignore */
              }
            }
          }, LIVE_WHISPER_SLICE_MS)
        }

        startLiveSliceCycleRef.current = sliceOnce
        liveCyclingRef.current = true
        waitForHandlerAttemptsRef.current = 0
      }

      if (runLiveSlice) {
        window.setTimeout(() => {
          if (liveCyclingRef.current && liveStreamRef.current) {
            startLiveSliceCycleRef.current?.()
          }
        }, 120)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Microphone access failed'
      setError(msg)
      stopStream()
    }
  }, [opts?.onLiveAudioChunkRef, opts?.experimentalSkipLiveSlice, stopStream])

  const pause = useCallback(() => {
    const mr = mediaRecorderRef.current
    if (!mr || mr.state !== 'recording') return
    haltLiveSliceCycle()
    audioContextRef.current?.suspend().catch(() => { /* ignore */ })
    const liveMr = liveSliceRecorderRef.current
    if (liveMr && liveMr.state !== 'inactive') {
      try {
        liveMr.onstop = () => {
          liveSliceRecorderRef.current = null
        }
        liveMr.stop()
      } catch {
        liveSliceRecorderRef.current = null
      }
    }
    mr.pause()
    setStatus('paused')
  }, [haltLiveSliceCycle])

  const resume = useCallback(() => {
    const mr = mediaRecorderRef.current
    if (!mr || mr.state !== 'paused') return
    mr.resume()
    audioContextRef.current?.resume().catch(() => { /* ignore */ })
    liveCyclingRef.current = true
    startLiveSliceCycleRef.current?.()
    setStatus('recording')
  }, [])

  const stop = useCallback((): Promise<{ blob: Blob; mime: string }> => {
    return new Promise((resolve, reject) => {
      const mr = mediaRecorderRef.current
      const liveMr = liveSliceRecorderRef.current

      if (!mr || mr.state === 'inactive') {
        reject(new Error('Not recording'))
        return
      }

      teardownLiveSliceCycle()

      const finishMain = () => {
        liveSliceRecorderRef.current = null
        const sessionTag = mainRecSessionIdRef.current.slice(-8)
        mainRecLine('stop', {
          session: sessionTag,
          preStopState: mr.state,
          chunkCount: chunksRef.current.length,
          chunkBytesBeforeFlush: chunksRef.current.reduce(
            (n, p) => n + (p instanceof Blob ? p.size : 0),
            0,
          ),
        })
        if (mainRequestDataTimerRef.current) {
          clearInterval(mainRequestDataTimerRef.current)
          mainRequestDataTimerRef.current = null
        }
        try {
          if (typeof mr.requestData === 'function') {
            mr.requestData()
            mainRecLine('flush', { session: sessionTag, kind: 'final_requestData_before_stop' })
          }
        } catch {
          /* requestData unsupported or wrong state */
        }
        mr.onstop = () => {
          const mime = mr.mimeType || mimeRef.current
          const parts = chunksRef.current
          const totalBytes = parts.reduce((n, p) => n + (p instanceof Blob ? p.size : 0), 0)
          const blob = new Blob(parts, { type: mime })
          mainRecLine('blob', {
            session: sessionTag,
            chunkCount: parts.length,
            totalBytes,
            finalBlobSize: blob.size,
            finalBlobType: blob.type || mime,
          })
          mediaRecorderRef.current = null
          stopStream()
          setStatus('idle')
          resolve({ blob, mime })
        }
        window.setTimeout(() => {
          try {
            mr.stop()
          } catch (stopErr) {
            mainRecLine('stop', {
              session: sessionTag,
              error: stopErr instanceof Error ? stopErr.message : String(stopErr),
            })
            reject(stopErr instanceof Error ? stopErr : new Error(String(stopErr)))
          }
        }, MAIN_RECORDER_STOP_FLUSH_MS)
      }

      if (liveMr && liveMr.state !== 'inactive') {
        liveMr.onstop = () => {
          liveSliceRecorderRef.current = null
          finishMain()
        }
        try {
          liveMr.stop()
        } catch {
          finishMain()
        }
      } else {
        finishMain()
      }
    })
  }, [teardownLiveSliceCycle, stopStream])

  const cancel = useCallback(() => {
    teardownLiveSliceCycle()
    const liveMr = liveSliceRecorderRef.current
    const mr = mediaRecorderRef.current
    if (mainRequestDataTimerRef.current) {
      clearInterval(mainRequestDataTimerRef.current)
      mainRequestDataTimerRef.current = null
    }
    if (liveMr && liveMr.state !== 'inactive') {
      try {
        liveMr.ondataavailable = null
        liveMr.onstop = () => {
          liveSliceRecorderRef.current = null
        }
        liveMr.stop()
      } catch {
        liveSliceRecorderRef.current = null
      }
    } else {
      liveSliceRecorderRef.current = null
    }
    if (mr && mr.state !== 'inactive') {
      mr.onstop = null
      mr.stop()
    }
    mediaRecorderRef.current = null
    chunksRef.current = []
    stopStream()
    setStatus('idle')
    setElapsedSec(0)
  }, [teardownLiveSliceCycle, stopStream])

  return {
    status,
    elapsedSec,
    error,
    start,
    pause,
    resume,
    stop,
    cancel,
  }
}
