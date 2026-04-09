import type { SVGProps } from 'react'
import {
  YOUMI_LENS_MARK_LOCKUP_VB_HEIGHT,
  YOUMI_LENS_MARK_LOCKUP_VB_WIDTH,
  YOUMI_LENS_MARK_LOCKUP_VIEWBOX,
  YOUMI_LENS_MARK_NAV_VB_HEIGHT,
  YOUMI_LENS_MARK_NAV_VB_WIDTH,
  YOUMI_LENS_MARK_NAV_VIEWBOX,
  YOUMI_LENS_MARK_PATH_LOCKUP,
  YOUMI_LENS_MARK_PATH_NAV,
} from './youmiLensMarkPaths'

/**
 * Master brand Y mark (extracted from official raster; see scripts/extract-youmi-y-mark.py).
 * For brand pages, marketing, large display - not the default for app chrome; use YoumiLensMonogramY there.
 * - `lockup`: fuller silhouette for hero / lockup-style rows
 * - `nav`: alternate extracted path (legacy pipeline)
 */
export type YoumiLensMarkYProps = Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'children'> & {
  size?: number | string
  color?: string
  variant?: 'lockup' | 'nav'
}

export function YoumiLensMarkY({
  size = 22,
  color = 'currentColor',
  variant = 'nav',
  className,
  style,
  'aria-hidden': ariaHidden = true,
  ...rest
}: YoumiLensMarkYProps) {
  const w = typeof size === 'number' ? `${size}px` : size
  const lockup = variant === 'lockup'
  const viewBox = lockup ? YOUMI_LENS_MARK_LOCKUP_VIEWBOX : YOUMI_LENS_MARK_NAV_VIEWBOX
  const vbW = lockup ? YOUMI_LENS_MARK_LOCKUP_VB_WIDTH : YOUMI_LENS_MARK_NAV_VB_WIDTH
  const vbH = lockup ? YOUMI_LENS_MARK_LOCKUP_VB_HEIGHT : YOUMI_LENS_MARK_NAV_VB_HEIGHT
  const d = lockup ? YOUMI_LENS_MARK_PATH_LOCKUP : YOUMI_LENS_MARK_PATH_NAV

  return (
    <svg
      className={className}
      style={{
        display: 'block',
        width: w,
        height: 'auto',
        aspectRatio: `${vbW} / ${vbH}`,
        flexShrink: 0,
        ...style,
      }}
      viewBox={viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={ariaHidden}
      {...rest}
    >
      <path fill={color} d={d} />
    </svg>
  )
}
