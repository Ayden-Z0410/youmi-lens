/**
 * Theme helpers  -  bridge tokens.ts to inline styles or CSS var names.
 */

import { colors, spacing, radii, fontSize, shadows } from './tokens'

export const theme = {
  colors,
  spacing,
  radii,
  fontSize,
  shadows,
} as const

/** CSS variable name for use in style={{ }} or className + tokens.css */
export function cssVar(name: `--ds-${string}`): string {
  return `var(${name})`
}
