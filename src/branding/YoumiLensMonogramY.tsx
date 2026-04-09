import type { SVGProps } from 'react'

/**
 * Minimal UI monogram: symmetric Y from stroked paths (round caps / join).
 * Not the master brand mark; use YoumiLensMarkY for large brand-only display.
 */

const VIEWBOX = '0 0 24 28'

/** Stroke width in user units (~medium weight for 24-wide viewBox). */
const SW = 2.35

export type YoumiLensMonogramYProps = Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'children'> & {
  size?: number | string
  color?: string
}

export function YoumiLensMonogramY({
  size = 22,
  color = 'currentColor',
  className,
  style,
  'aria-hidden': ariaHidden = true,
  ...rest
}: YoumiLensMonogramYProps) {
  const w = typeof size === 'number' ? `${size}px` : size

  return (
    <svg
      className={className}
      style={{
        display: 'block',
        width: w,
        height: 'auto',
        aspectRatio: '24 / 28',
        flexShrink: 0,
        ...style,
      }}
      viewBox={VIEWBOX}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={ariaHidden}
      {...rest}
    >
      <g
        stroke={color}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        {/* Symmetric V: equal arms, single join at the fork */}
        <path d="M5.5 5.5L12 14L18.5 5.5" />
        {/* Stem: same centerline as fork */}
        <path d="M12 14L12 24.5" />
      </g>
    </svg>
  )
}
