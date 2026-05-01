/**
 * SmoothCaption — UI smoothing for streaming caption text.
 *
 * DashScope emits interim ASR results in 200–500ms bursts of 1–3 words. Without
 * smoothing the caption "jumps" between bursts. This component lerps the
 * displayed text toward the target over ~120ms when the target grows by append,
 * and replaces instantly when the target changes substantively (segment break,
 * de-overlap shrink, clear). It never fabricates characters not present in the
 * latest target.
 */
import { useEffect, useRef, useState } from 'react'

const TARGET_REVEAL_MS = 120
const MIN_CHAR_MS = 8

type SmoothCaptionProps = {
  value: string
}

export function SmoothCaption({ value }: SmoothCaptionProps) {
  const [displayed, setDisplayed] = useState(value)
  const targetRef = useRef(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    targetRef.current = value
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    setDisplayed((prev) => {
      if (prev === value) return prev
      if (!value.startsWith(prev)) return value

      const delta = value.length - prev.length
      const charMs = Math.max(MIN_CHAR_MS, Math.floor(TARGET_REVEAL_MS / Math.max(1, delta)))

      const tick = () => {
        setDisplayed((cur) => {
          const target = targetRef.current
          if (cur === target) {
            timerRef.current = null
            return cur
          }
          if (!target.startsWith(cur)) {
            timerRef.current = null
            return target
          }
          const next = target.slice(0, cur.length + 1)
          timerRef.current = next === target ? null : setTimeout(tick, charMs)
          return next
        })
      }

      timerRef.current = setTimeout(tick, charMs)
      return prev.length < value.length ? value.slice(0, prev.length + 1) : prev
    })

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [value])

  return <>{displayed}</>
}
