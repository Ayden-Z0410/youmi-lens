/**
 * SmoothCaption — word-drip reveal for streaming interim caption text.
 *
 * DashScope delivers interim packets every ~200–500ms, each carrying several
 * new words at once. Snapping all words in simultaneously feels "chunky".
 *
 * Strategy: when a new value arrives, diff it against what is currently
 * displayed, then drip the new words in one at a time (~60ms apart) so the
 * text appears to grow continuously — matching natural speech rhythm.
 *
 * Rules:
 * - Word-level only (no character animation, no RAF).
 * - Single timeout chain; new value preempts the in-flight drip.
 * - Snap immediately when the diff is too large (>12 words) or the new value
 *   doesn't share a common prefix with what is displayed (topic jump / reset).
 * - Only affects rendering. Persisted/final text is never dripped.
 */

import { useEffect, useRef, useState } from 'react'

type SmoothCaptionProps = {
  value: string
}

const DRIP_INTERVAL_MS = 60
const SNAP_THRESHOLD_WORDS = 12

/** Extract only the suffix of `next` that follows the `prev` prefix. */
function newWordSuffix(prev: string, next: string): string[] {
  const p = prev.trimEnd()
  const n = next.trimEnd()
  if (!n.startsWith(p)) return []
  const tail = n.slice(p.length).trim()
  if (!tail) return []
  return tail.split(/\s+/)
}

export function SmoothCaption({ value }: SmoothCaptionProps) {
  const [displayed, setDisplayed] = useState(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queueRef = useRef<string[]>([])
  const baseRef = useRef<string>(value)

  useEffect(() => {
    // Cancel any in-flight drip.
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    const newWords = newWordSuffix(displayed, value)

    // Snap immediately: no common prefix, or diff too large.
    if (newWords.length === 0 || newWords.length > SNAP_THRESHOLD_WORDS) {
      queueRef.current = []
      baseRef.current = value
      setDisplayed(value)
      return
    }

    // Set up a fresh drip queue starting from what is currently displayed.
    baseRef.current = displayed
    queueRef.current = newWords

    function drip() {
      const word = queueRef.current.shift()
      if (word === undefined) return
      baseRef.current = baseRef.current.trimEnd() + ' ' + word
      setDisplayed(baseRef.current)
      if (queueRef.current.length > 0) {
        timerRef.current = setTimeout(drip, DRIP_INTERVAL_MS)
      } else {
        timerRef.current = null
      }
    }

    timerRef.current = setTimeout(drip, DRIP_INTERVAL_MS)

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
    // `displayed` is intentionally excluded: we read it at effect time via closure,
    // but we don't want to re-trigger the effect when `displayed` changes internally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return <>{displayed}</>
}
