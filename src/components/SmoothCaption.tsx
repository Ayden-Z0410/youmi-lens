/**
 * SmoothCaption — renders streaming caption text.
 *
 * DashScope sends cumulative interim sentences ("today we are" → "today we are
 * going to talk") at 200–500ms intervals. The text naturally grows as a phrase.
 * This component renders the full current value immediately — no character-level
 * animation, no incremental reveal. The phrase-growth cadence from DashScope is
 * the smoothing.
 */

type SmoothCaptionProps = {
  value: string
}

export function SmoothCaption({ value }: SmoothCaptionProps) {
  return <>{value}</>
}
