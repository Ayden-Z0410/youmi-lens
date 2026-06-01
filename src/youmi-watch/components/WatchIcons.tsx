/**
 * Minimal stroke icon set for Youmi Watch. Inline SVG (no icon-font / package
 * dependency) so the dashboard stays self-contained. Icons inherit
 * `currentColor` and a 1.7 stroke width tuned for the glass UI.
 */
import type { SVGProps } from 'react'

export type IconName =
  | 'overview'
  | 'providers'
  | 'users'
  | 'logs'
  | 'settings'
  | 'mic'
  | 'sparkles'
  | 'alert'
  | 'link'
  | 'check-circle'
  | 'offline'
  | 'server'
  | 'database'
  | 'refresh'
  | 'rocket'
  | 'user-plus'
  | 'chevron-down'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

const PATHS: Record<IconName, React.ReactNode> = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  providers: (
    <>
      <path d="M12 3a4 4 0 0 0-4 4c0 1.5.8 2.6 1.8 3.4" />
      <path d="M12 21a4 4 0 0 0 4-4c0-1.5-.8-2.6-1.8-3.4" />
      <path d="M5 12a3 3 0 0 1 3-3h8a3 3 0 0 1 0 6H8a3 3 0 0 1-3-3Z" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5.6" />
      <path d="M17 14a5 5 0 0 1 3.5 5" />
    </>
  ),
  logs: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2 5.6 5.6" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0" />
      <path d="M12 17v4M9 21h6" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
      <path d="M18.5 14.5l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9Z" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4 2.8 20h18.4L12 4Z" />
      <path d="M12 10v4M12 17.2v.2" />
    </>
  ),
  link: (
    <>
      <path d="M9.5 14.5l5-5" />
      <path d="M8 12l-2.2 2.2a3.1 3.1 0 0 0 4.4 4.4L12 16.5" />
      <path d="M16 12l2.2-2.2a3.1 3.1 0 0 0-4.4-4.4L12 7.5" />
    </>
  ),
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </>
  ),
  offline: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.5 5.5l13 13" />
    </>
  ),
  server: (
    <>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5v.2M7 16.5v.2" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
      <path d="M4.5 5.5v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-6" />
      <path d="M4.5 11.5v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-6" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14.3-4.3M4 5v3.5h3.5" />
      <path d="M4 13a8 8 0 0 0 14.3 4.3M20 19v-3.5h-3.5" />
    </>
  ),
  rocket: (
    <>
      <path d="M5 14c-1.5 1.5-2 5-2 5s3.5-.5 5-2" />
      <path d="M9 15l-3-3c1-5 5-9 11-9 0 6-4 10-9 11Z" />
      <circle cx="14.5" cy="9.5" r="1.3" />
    </>
  ),
  'user-plus': (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M18 7v5M15.5 9.5h5" />
    </>
  ),
  'chevron-down': <path d="M6 9l6 6 6-6" />,
}

export function WatchIcon({ name, size = 18, ...rest }: IconProps & { name: IconName }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {PATHS[name]}
    </svg>
  )
}
