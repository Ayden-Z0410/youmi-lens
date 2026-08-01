/**
 * Username validation for the auth screens, with the Website's exact copy.
 *
 * The RULES are not redefined here — `validateDisplayName` in src/lib/profileFields.ts
 * stays the single authority on what is valid (trim, 2–64 characters, no ASCII control
 * characters, matching the DB index `profiles_username_lower_unique`). This module only
 * supplies the user-facing wording, because the desktop module says "Display name" while
 * the Website and its mirror (landing/app/profileFields.js) say "Username", and this
 * round requires the Website's copy verbatim.
 *
 * Consequence: if the rules ever change in profileFields.ts, this stays correct — only
 * the wording lives here.
 */
import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  validateDisplayName,
} from '../../lib/profileFields'

export const USERNAME_MIN_LENGTH = DISPLAY_NAME_MIN_LENGTH
export const USERNAME_MAX_LENGTH = DISPLAY_NAME_MAX_LENGTH

export type ValidateUsernameResult =
  | { ok: true; value: string }
  | { ok: false; message: string }

export function validateUsername(raw: string): ValidateUsernameResult {
  const value = String(raw ?? '').trim()
  const base = validateDisplayName(value)
  if (base.ok) return { ok: true, value: base.value }

  // Rejected by the shared rules — restate the reason in the Website's words.
  if (!value) return { ok: false, message: 'Enter a username.' }
  if (value.length < USERNAME_MIN_LENGTH) {
    return { ok: false, message: `Username must be at least ${USERNAME_MIN_LENGTH} characters.` }
  }
  if (value.length > USERNAME_MAX_LENGTH) {
    return { ok: false, message: `Username must be at most ${USERNAME_MAX_LENGTH} characters.` }
  }
  return { ok: false, message: 'Username cannot contain control characters.' }
}
