/**
 * Youmi Lens design tokens  -  single source of truth for TS/JS.
 * Mirror: tokens.css (for components that prefer CSS variables).
 */

export const colors = {
  primary: '#0B1F3B',
  secondary: '#1E3A5F',
  bgPage: '#F5F7FA',
  surface: '#FFFFFF',
  highlight: '#C8D7E8',
  accent: '#3D6A9E',
  text: '#0F172A',
  textMuted: '#64748B',
  border: '#E2E8F0',
  danger: '#B91C1C',
  success: '#0F766E',
} as const

export const spacing = {
  px: 1,
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const

export const radii = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  '2xl': 16,
  full: 9999,
} as const

export const fontSize = {
  xs: '0.7rem',
  sm: '0.8rem',
  base: '0.9375rem',
  md: '1rem',
  lg: '1.125rem',
  xl: '1.25rem',
  '2xl': '1.5rem',
  '3xl': '1.75rem',
} as const

export const fontWeight = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const

export const lineHeight = {
  tight: 1.2,
  normal: 1.45,
  relaxed: 1.55,
} as const

export const shadows = {
  none: 'none',
  sm: '0 1px 2px rgba(15, 23, 42, 0.06)',
  md: '0 4px 12px rgba(15, 23, 42, 0.08)',
  lg: '0 10px 24px rgba(15, 23, 42, 0.1)',
  focus: '0 0 0 2px #FFFFFF, 0 0 0 4px #3D6A9E',
} as const

export const zIndex = {
  base: 0,
  dropdown: 10,
  sticky: 20,
  modal: 100,
} as const

/** Semantic token map for documentation / tooling */
export const designTokens = {
  colors,
  spacing,
  radii,
  fontSize,
  fontWeight,
  lineHeight,
  shadows,
  zIndex,
} as const

export type DesignTokens = typeof designTokens
