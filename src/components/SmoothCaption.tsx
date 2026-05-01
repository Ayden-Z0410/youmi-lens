/**
 * SmoothCaption — UI smoothing for streaming caption text.
 *
 * DashScope emits interim ASR results in 200–500ms bursts of 1–3 words. Without
 * smoothing the caption "jumps" between bursts. This component reveals text one
 * character at a time, spaced by charMs (derived from delta and REVEAL_MS), using
 * requestAnimationFrame as the scheduler instead of nested setTimeouts.
 *
 * Original behavior restored:
 *  - First character appears immediately (in effect body, before first RAF)
 *  - Remaining chars appear one-at-a-time at evenly-spaced intervals (charMs each)
 *  - charMs = max(16, floor(REVEAL_MS / delta)) → 16ms floor = one display frame max rate
 *  - Snap immediately for: non-prefix change, shrink, or burst > SNAP_THRESHOLD chars
 *  - Never fabricates characters not present in the latest target
 *
 * Performance vs original setTimeout cascade:
 *  - Original MIN_CHAR_MS=8 could fire 125 setState calls/second
 *  - RAF floor of 16ms caps at 60fps (display-aligned, no wasted renders between frames)
 */
import { useEffect, useRef, useState } from 'react'

const REVEAL_MS = 120
const MIN_CHAR_MS = 16   // one display frame — prevents exceeding 60fps
const SNAP_THRESHOLD = 50

type SmoothCaptionProps = {
  value: string
}

export function SmoothCaption({ value }: SmoothCaptionProps) {
  const [displayed, setDisplayed] = useState(value)
  /** Mirrors displayed state so RAF callbacks read current position without stale closure. */
  const displayedRef = useRef(value)
  /** Always holds the latest target; updated synchronously at effect start. */
  const targetRef = useRef(value)
  const animRef = useRef<{ rafId: number; charMs: number; lastAdvance: number }>({
    rafId: 0,
    charMs: MIN_CHAR_MS,
    lastAdvance: 0,
  })

  useEffect(() => {
    const a = animRef.current

    if (a.rafId) {
      cancelAnimationFrame(a.rafId)
      a.rafId = 0
    }

    targetRef.current = value
    const cur = displayedRef.current
    const delta = value.length - cur.length

    // Snap for: segment break/non-prefix, shrink, large burst
    if (!value.startsWith(cur) || delta < 0 || delta > SNAP_THRESHOLD) {
      displayedRef.current = value
      setDisplayed(value)
      return
    }

    if (delta === 0) return  // identical text, nothing to do

    // Per-char interval: same formula as original, floored at one display frame
    a.charMs = Math.max(MIN_CHAR_MS, Math.floor(REVEAL_MS / delta))

    // Show first char immediately — matching original effect-body reveal
    const first = value.slice(0, cur.length + 1)
    displayedRef.current = first
    setDisplayed(first)
    if (first === value) return  // only 1 char to add, done

    a.lastAdvance = performance.now()

    const tick = (now: number) => {
      // Respect per-char interval: skip frames that arrive too soon
      if (now - a.lastAdvance < a.charMs) {
        a.rafId = requestAnimationFrame(tick)
        return
      }
      a.lastAdvance = now

      const target = targetRef.current
      const prevDisplayed = displayedRef.current

      // If target changed to an incompatible string while we were animating, snap
      if (!target.startsWith(prevDisplayed)) {
        displayedRef.current = target
        setDisplayed(target)
        a.rafId = 0
        return
      }

      const next = target.slice(0, prevDisplayed.length + 1)
      displayedRef.current = next
      setDisplayed(next)

      if (next.length < target.length) {
        a.rafId = requestAnimationFrame(tick)
      } else {
        a.rafId = 0
      }
    }

    a.rafId = requestAnimationFrame(tick)

    return () => {
      if (a.rafId) {
        cancelAnimationFrame(a.rafId)
        a.rafId = 0
      }
    }
  }, [value])

  return <>{displayed}</>
}
