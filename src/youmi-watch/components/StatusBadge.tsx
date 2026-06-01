/**
 * StatusBadge — pill-shaped status indicator. Colour is derived from the status
 * kind via a CSS modifier class; an optional leading dot reinforces the state.
 */
import type { StatusKind } from '../data/mockData'

export interface StatusBadgeProps {
  status: StatusKind
  label: string
  /** Show the leading dot (default true). */
  dot?: boolean
}

export function StatusBadge({ status, label, dot = true }: StatusBadgeProps) {
  return (
    <span className={`yw-badge yw-badge--${status}`}>
      {dot && <span className="yw-badge__dot" />}
      {label}
    </span>
  )
}
