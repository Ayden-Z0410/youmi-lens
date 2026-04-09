/** Matches DB index `lower(trim(username))` for comparisons. */
export function normalizedDisplayNameKey(raw: string): string {
  return raw.trim().toLowerCase()
}

export const DISPLAY_NAME_MAX_LENGTH = 64

/** User-facing copy when global unique display name collides (constraint `profiles_username_lower_unique`). */
export const DISPLAY_NAME_TAKEN_MESSAGE =
  'This display name is already taken. Try another one.'

function hasAsciiControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return true
  }
  return false
}

export type ValidateDisplayNameResult =
  | { ok: true; value: string }
  | { ok: false; message: string }

/** Trim, length, and obvious invalid characters (aligned with how we store plain text). */
export function validateDisplayName(raw: string): ValidateDisplayNameResult {
  const value = raw.trim()
  if (!value) {
    return { ok: false, message: 'Enter a display name.' }
  }
  if (value.length > DISPLAY_NAME_MAX_LENGTH) {
    return { ok: false, message: `Display name must be at most ${DISPLAY_NAME_MAX_LENGTH} characters.` }
  }
  if (hasAsciiControl(value)) {
    return { ok: false, message: 'Display name cannot contain control characters.' }
  }
  return { ok: true, value }
}

/** Optional phone: empty or placeholder → null. */
export function normalizeOptionalPhone(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim()
  if (!t) return null
  if (/^skip\s*for\s*now$/i.test(t)) return null
  return t
}
