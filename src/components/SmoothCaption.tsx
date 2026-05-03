/**
 * SmoothCaption — passthrough renderer for streaming interim caption text.
 * No animation. The upstream ASR cadence determines perceived smoothness.
 */

type SmoothCaptionProps = {
  value: string
}

export function SmoothCaption({ value }: SmoothCaptionProps) {
  return <>{value}</>
}
