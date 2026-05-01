/**
 * SmoothCaption — UI smoothing for streaming caption text.
 *
 * DashScope emits interim ASR results in 200–500ms bursts. Without smoothing
 * the caption "jumps" between bursts. This component animates the displayed
 * text toward the target using requestAnimationFrame (≤60fps) over REVEAL_MS.
 *
 * One RAF per animation frame replaces the old per-character setTimeout cascade
 * that could fire 100+ setState calls per second and saturate the React scheduler.
 *
 * Rules:
 *  - Grows by append → animate over REVEAL_MS via linear interpolation
 *  - Large burst (>SNAP_THRESHOLD chars) or incompatible change → snap instantly
 *  - Never fabricates characters not present in the latest target
 */
import { useEffect, useRef, useState } from 'react'

const REVEAL_MS = 120
const SNAP_THRESHOLD = 50

type SmoothCaptionProps = {
  value: string
}

export function SmoothCaption({ value }: SmoothCaptionProps) {
  const [displayed, setDisplayed] = useState(value)
  /** Mirrors displayed state so effects can read current value without stale closure. */
  const displayedRef = useRef(value)
  /** Latest target — updated synchronously at effect start so RAF callback always sees it. */
  const targetRef = useRef(value)
  const animRef = useRef<{ rafId: number; baseLen: number; startTime: number }>({
    rafId: 0,
    baseLen: value.length,
    startTime: 0,
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
    const shouldSnap = !value.startsWith(cur) || delta > SNAP_THRESHOLD || delta <= 0

    if (shouldSnap) {
      displayedRef.current = value
      setDisplayed(value)
      a.baseLen = value.length
      return
    }

    if (value === cur) return

    a.baseLen = cur.length
    a.startTime = performance.now()

    const tick = (now: number) => {
      const target = targetRef.current
      const elapsed = now - a.startTime
      const progress = Math.min(1, elapsed / REVEAL_MS)
      const showLen = Math.min(target.length, Math.round(a.baseLen + (target.length - a.baseLen) * progress))
      const next = target.slice(0, showLen)

      displayedRef.current = next
      setDisplayed(next)

      if (progress < 1 && showLen < target.length) {
        a.rafId = requestAnimationFrame(tick)
      } else {
        displayedRef.current = target
        setDisplayed(target)
        a.rafId = 0
        a.baseLen = target.length
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
