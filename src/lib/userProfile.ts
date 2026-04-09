import type { SupabaseClient } from '@supabase/supabase-js'
import {
  DISPLAY_NAME_TAKEN_MESSAGE,
  normalizeOptionalPhone,
  validateDisplayName,
} from './profileFields'

export type UserProfileRow = {
  id: string
  username: string | null
  phone: string | null
  first_shell_seen_at: string | null
  created_at: string
  updated_at: string
}

const TABLE = 'profiles'

/**
 * Maps PostgREST / Postgres errors to user-safe copy.
 * Constraint: `profiles_username_lower_unique` on lower(trim(username)).
 */
export function mapProfileUpsertErrorToUserMessage(raw: string): string {
  const m = raw.toLowerCase()
  if (
    m.includes('profiles_username_lower_unique') ||
    (m.includes('duplicate key') && m.includes('username'))
  ) {
    return DISPLAY_NAME_TAKEN_MESSAGE
  }
  console.warn('[profile] upsert failed', raw)
  return 'We could not save your profile. Please try again in a moment.'
}

/**
 * True when the user must complete the display-name onboarding.
 * - No row yet (null) → onboarding
 * - Row exists but username is null, non-string, or only whitespace → onboarding
 * Do not treat "has a profile row" as "onboarding done".
 */
export function profileNeedsUsernameOnboarding(row: UserProfileRow | null): boolean {
  if (row == null) return true
  const u = row.username
  if (u == null) return true
  if (typeof u !== 'string') return true
  return u.trim().length === 0
}

/** Valid saved display name in `profiles.username`. */
export function profileHasUsername(row: UserProfileRow | null): boolean {
  return !profileNeedsUsernameOnboarding(row)
}

export async function fetchProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserProfileRow | null> {
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', userId).maybeSingle()
  if (error) {
    console.warn('[profile] fetch failed', error.message)
    return null
  }
  return data as UserProfileRow | null
}

/**
 * Returns whether another profile already uses this display name (case-insensitive, trimmed),
 * per DB rules. Requires `profile_display_name_taken` RPC (optional migration); if RPC is
 * missing, returns { taken: false } so the upsert path still applies.
 */
export async function isProfileDisplayNameTakenByOther(
  supabase: SupabaseClient,
  selfUserId: string,
  candidateRaw: string,
): Promise<{ taken: boolean }> {
  const v = validateDisplayName(candidateRaw)
  if (!v.ok) return { taken: false }
  const { data, error } = await supabase.rpc('profile_display_name_taken', {
    p_candidate: v.value,
    p_self: selfUserId,
  })
  if (error) {
    console.warn('[profile] profile_display_name_taken RPC unavailable or failed', error.message)
    return { taken: false }
  }
  return { taken: Boolean(data) }
}

export async function upsertProfileUsername(
  supabase: SupabaseClient,
  userId: string,
  fields: { username: string; phone?: string | null },
): Promise<{ error: string | null }> {
  const validated = validateDisplayName(fields.username)
  if (!validated.ok) return { error: validated.message }

  const row = {
    id: userId,
    username: validated.value,
    phone: normalizeOptionalPhone(fields.phone ?? null),
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase.from(TABLE).upsert(row, { onConflict: 'id' })
  if (error) return { error: mapProfileUpsertErrorToUserMessage(error.message) }
  return { error: null }
}

export async function markFirstShellSeen(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('first_shell_seen_at')
    .eq('id', userId)
    .maybeSingle()
  if (error) return
  const row = data as { first_shell_seen_at: string | null } | null
  if (row?.first_shell_seen_at) return
  await supabase
    .from(TABLE)
    .update({ first_shell_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', userId)
}
