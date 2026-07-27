/**
 * Website port of the EXISTING Youmi Lens username contract.
 *
 * The canonical rules live in Desktop's src/lib/profileFields.ts, which the
 * static site cannot import (TypeScript, outside landing/). This mirrors it
 * exactly so client and server agree:
 *
 *   • trim leading/trailing whitespace; inner spaces and Unicode are preserved
 *   • 2–64 characters
 *   • no ASCII control characters
 *   • case preserved for storage, compared lower(trim(...)) to match the DB
 *     index profiles_username_lower_unique
 *
 * Deliberately NOT here: alphanumeric-only filtering, a 32-character cap, and
 * reserved names — none of those exist in the product contract. This is the same
 * `username` field the backend already accepts; it is not a public handle.
 */
export const USERNAME_MIN_LENGTH = 2
export const USERNAME_MAX_LENGTH = 64

/** Matches the DB index `lower(trim(username))` for comparisons. */
export function usernameKey(raw) {
  return String(raw ?? '').trim().toLowerCase()
}

function hasAsciiControl(s) {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return true
  }
  return false
}

/**
 * → { ok: true, value } with the normalized (trimmed) username,
 *   or { ok: false, message } with copy matching the existing product.
 */
export function validateUsername(raw) {
  const value = String(raw ?? '').trim()
  if (!value) return { ok: false, message: 'Enter a username.' }
  if (value.length < USERNAME_MIN_LENGTH) {
    return { ok: false, message: `Username must be at least ${USERNAME_MIN_LENGTH} characters.` }
  }
  if (value.length > USERNAME_MAX_LENGTH) {
    return { ok: false, message: `Username must be at most ${USERNAME_MAX_LENGTH} characters.` }
  }
  if (hasAsciiControl(value)) {
    return { ok: false, message: 'Username cannot contain control characters.' }
  }
  return { ok: true, value }
}
