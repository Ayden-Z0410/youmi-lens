/**
 * Youmi Lens Beta Gate — server-side quota enforcement.
 *
 * Plan tiers:
 *   public_trial  — 20 min lifetime total, 10 min/recording, 2/day, 10 min live session
 *   core_tester   — 1000 min/month, 120 min/recording, 10/day, 120 min live session
 *   student_basic / student_pro — reserved; treated as public_trial until activated
 *   admin         — bypass all limits
 *
 * Billable actions (count toward quota):
 *   process_recording, regenerate_summary
 *
 * Non-billable (logged for monitoring only):
 *   upload_audio, live_caption_session, transcription, summary_generation, translate_caption
 *
 * Error codes returned to clients:
 *   auth_required              — JWT missing or invalid
 *   quota_required             — quota row could not be created/read
 *   beta_limit_reached         — lifetime or monthly quota exhausted
 *   recording_too_long         — recording exceeds per-recording minute limit
 *   daily_recording_limit_reached — too many recordings processed today
 *   quota_suspended            — account suspended
 */

import { createClient } from '@supabase/supabase-js'

// ── Constants ──────────────────────────────────────────────────────────────────

export const BETA_LIMIT_MESSAGE =
  'Free beta limit reached. Please contact Youmi Lens for more access.'

export const BETA_ERROR_CODES = {
  AUTH_REQUIRED: 'auth_required',
  QUOTA_REQUIRED: 'quota_required',
  BETA_LIMIT_REACHED: 'beta_limit_reached',
  RECORDING_TOO_LONG: 'recording_too_long',
  DAILY_LIMIT_REACHED: 'daily_recording_limit_reached',
  SUSPENDED: 'quota_suspended',
}

/** Default limits for new public_trial users (overridable via env for testing). */
const DEFAULT_TRIAL_MINUTES = Number(process.env.BETA_MAX_TRIAL_MINUTES || 20)
const DEFAULT_MAX_RECORDING_MINUTES = Number(process.env.BETA_MAX_RECORDING_MINUTES || 10)
const DEFAULT_MAX_RECORDINGS_PER_DAY = Number(process.env.BETA_MAX_RECORDINGS_PER_DAY || 2)
const DEFAULT_MAX_LIVE_SESSION_MINUTES = Number(process.env.BETA_MAX_LIVE_SESSION_MINUTES || 10)

/** Plans that use monthly quota (calendar-month reset). */
const MONTHLY_PLANS = new Set(['core_tester'])
/** Plans that use lifetime quota (never resets). */
const LIFETIME_PLANS = new Set(['public_trial', 'student_basic', 'student_pro'])

// ── Supabase admin client ──────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

let _adminClient = null
function getAdminClient() {
  if (!_adminClient && SUPABASE_URL && SERVICE_ROLE_KEY) {
    _adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return _adminClient
}

let _anonClient = null
export function getAnonClient() {
  if (!_anonClient && SUPABASE_URL && ANON_KEY) {
    _anonClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return _anonClient
}

// ── JWT verification ───────────────────────────────────────────────────────────

/**
 * Verify a Supabase JWT and return { userId, email }.
 * Returns null on failure.
 */
export async function verifyJwt(token) {
  if (!token || typeof token !== 'string') return null
  const anon = getAnonClient()
  if (!anon) return null
  try {
    const { data, error } = await anon.auth.getUser(token)
    if (error || !data?.user?.id) return null
    return { userId: data.user.id, email: data.user.email || '' }
  } catch {
    return null
  }
}

// ── Quota management ───────────────────────────────────────────────────────────

/**
 * Get the user's quota row, creating a public_trial row if none exists.
 * Returns null only if the DB is unavailable.
 */
export async function getOrCreateUserQuota(userId, email) {
  const db = getAdminClient()
  if (!db) return null

  const { data: existing } = await db
    .from('user_quota')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (existing) return existing

  // First-time user: create public_trial row
  const { data: created, error } = await db
    .from('user_quota')
    .insert({
      user_id: userId,
      email: (email || '').toLowerCase(),
      plan_type: 'public_trial',
      total_trial_minutes_limit: DEFAULT_TRIAL_MINUTES,
      monthly_minutes_limit: null,
      max_recording_minutes: DEFAULT_MAX_RECORDING_MINUTES,
      max_recordings_per_day: DEFAULT_MAX_RECORDINGS_PER_DAY,
      max_live_session_minutes: DEFAULT_MAX_LIVE_SESSION_MINUTES,
      extra_minutes_balance: 0,
      status: 'active',
    })
    .select()
    .single()

  if (error) {
    // Race: another request already inserted, re-fetch
    const { data: retry } = await db
      .from('user_quota')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
    return retry || null
  }
  return created
}

// ── Usage queries ──────────────────────────────────────────────────────────────

/** Sum of billable_minutes for billable action types (process_recording + regenerate_summary). */
export async function getBillableMinutesUsed(userId, { sinceIso } = {}) {
  const db = getAdminClient()
  if (!db) return 0
  let q = db
    .from('beta_usage')
    .select('billable_minutes')
    .eq('user_id', userId)
    .in('action_type', ['process_recording', 'regenerate_summary'])
  if (sinceIso) q = q.gte('created_at', sinceIso)
  const { data } = await q
  return (data ?? []).reduce((sum, r) => sum + Number(r.billable_minutes ?? 0), 0)
}

/** Count of billable actions today (UTC day). */
export async function getDailyRecordingCount(userId) {
  const db = getAdminClient()
  if (!db) return 0
  const now = new Date()
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString()
  const { count, error } = await db
    .from('beta_usage')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('action_type', ['process_recording', 'regenerate_summary'])
    .gte('created_at', todayStart)
  if (error) return 0
  return count ?? 0
}

/** Sum billable usage for the quota period used by the user's current plan. */
export async function getUsedMinutes(userId, quota) {
  if (!quota) return 0
  if (LIFETIME_PLANS.has(quota.plan_type)) {
    return getBillableMinutesUsed(userId)
  }
  if (MONTHLY_PLANS.has(quota.plan_type)) {
    const now = new Date()
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString()
    return getBillableMinutesUsed(userId, { sinceIso: monthStart })
  }
  return 0
}

/** Count billable recording-generation actions since UTC day start. */
export async function getDailyCount(userId) {
  return getDailyRecordingCount(userId)
}

// ── Gate functions ─────────────────────────────────────────────────────────────

/**
 * Build a structured error response object (for use in res.status(4xx).json(...)).
 */
export function betaError(code, message, details = {}) {
  return { error: code, message, details }
}

/**
 * Check whether a cloud audio upload is allowed for this user.
 * Only enforces per-recording duration limit (to prevent uploading 2-hour files).
 * Quota (daily/monthly) is enforced at process time, not at upload time.
 *
 * @param {object} quota  — result of getOrCreateUserQuota()
 * @param {number} durationSec  — recording duration in seconds (from client)
 * @returns {{ allowed: true } | { allowed: false, status: number, body: object }}
 */
export function checkUploadAllowed(quota, durationSec) {
  if (!quota) return { allowed: true } // can't enforce without quota row

  if (quota.status === 'suspended') {
    return {
      allowed: false,
      status: 403,
      body: betaError(BETA_ERROR_CODES.SUSPENDED, BETA_LIMIT_MESSAGE, {}),
    }
  }

  if (quota.plan_type === 'admin') return { allowed: true }

  const maxSec = quota.max_recording_minutes * 60
  if (durationSec > maxSec) {
    return {
      allowed: false,
      status: 403,
      body: betaError(
        BETA_ERROR_CODES.RECORDING_TOO_LONG,
        `Recording is ${Math.ceil(durationSec / 60)} min but your plan allows max ${quota.max_recording_minutes} min per recording. ${BETA_LIMIT_MESSAGE}`,
        {
          recording_minutes: Math.ceil(durationSec / 60),
          limit_minutes: quota.max_recording_minutes,
        },
      ),
    }
  }

  return { allowed: true }
}

/**
 * Check whether a new AI processing action is allowed.
 * Enforces: per-recording duration, daily count, lifetime/monthly quota.
 *
 * @param {object} quota
 * @param {string} userId
 * @param {number} durationSec  — from recordings.duration_sec
 * @returns {Promise<{ allowed: true } | { allowed: false, status: number, body: object }>}
 */
export async function checkProcessingAllowed(quota, userId, durationSec) {
  if (!quota) return { allowed: true }

  if (quota.status === 'suspended') {
    return {
      allowed: false,
      status: 403,
      body: betaError(BETA_ERROR_CODES.SUSPENDED, BETA_LIMIT_MESSAGE, {}),
    }
  }

  if (quota.plan_type === 'admin') return { allowed: true }

  // Per-recording duration check
  const maxSec = quota.max_recording_minutes * 60
  if (durationSec > maxSec) {
    return {
      allowed: false,
      status: 403,
      body: betaError(
        BETA_ERROR_CODES.RECORDING_TOO_LONG,
        `Recording is ${Math.ceil(durationSec / 60)} min but your plan allows max ${quota.max_recording_minutes} min per recording. ${BETA_LIMIT_MESSAGE}`,
        {
          recording_minutes: Math.ceil(durationSec / 60),
          limit_minutes: quota.max_recording_minutes,
        },
      ),
    }
  }

  // Daily count check
  const todayCount = await getDailyRecordingCount(userId)
  if (todayCount >= quota.max_recordings_per_day) {
    return {
      allowed: false,
      status: 429,
      body: betaError(
        BETA_ERROR_CODES.DAILY_LIMIT_REACHED,
        `You've reached ${quota.max_recordings_per_day} processed recordings today. ${BETA_LIMIT_MESSAGE}`,
        { used_today: todayCount, limit_today: quota.max_recordings_per_day },
      ),
    }
  }

  // Quota (lifetime or monthly) check
  const billableMinutes = Math.ceil((durationSec || 0) / 60)
  let usedMinutes = 0
  let limitMinutes = Infinity

  if (LIFETIME_PLANS.has(quota.plan_type)) {
    usedMinutes = await getBillableMinutesUsed(userId)
    limitMinutes = quota.total_trial_minutes_limit + (quota.extra_minutes_balance || 0)
  } else if (MONTHLY_PLANS.has(quota.plan_type) && quota.monthly_minutes_limit != null) {
    const now = new Date()
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString()
    usedMinutes = await getBillableMinutesUsed(userId, { sinceIso: monthStart })
    limitMinutes = quota.monthly_minutes_limit + (quota.extra_minutes_balance || 0)
  }

  if (usedMinutes + billableMinutes > limitMinutes) {
    return {
      allowed: false,
      status: 403,
      body: betaError(
        BETA_ERROR_CODES.BETA_LIMIT_REACHED,
        BETA_LIMIT_MESSAGE,
        {
          used_minutes: Math.round(usedMinutes),
          limit_minutes: limitMinutes,
          recording_minutes: billableMinutes,
        },
      ),
    }
  }

  return { allowed: true }
}

/**
 * Check whether a live caption session is allowed for this user.
 * Blocks if quota is fully exhausted. Does not deduct from quota.
 *
 * @param {object} quota
 * @param {string} userId
 * @returns {Promise<{ allowed: true, maxSessionMinutes: number } | { allowed: false, status: number, body: object }>}
 */
export async function checkLiveSessionAllowed(quota, userId) {
  if (!quota) return { allowed: true, maxSessionMinutes: DEFAULT_MAX_LIVE_SESSION_MINUTES }

  if (quota.status === 'suspended') {
    return {
      allowed: false,
      status: 403,
      body: betaError(BETA_ERROR_CODES.SUSPENDED, BETA_LIMIT_MESSAGE, {}),
    }
  }

  if (quota.plan_type === 'admin') {
    return { allowed: true, maxSessionMinutes: Infinity }
  }

  // Check if quota is already exhausted (block live session start if so)
  let usedMinutes = 0
  let limitMinutes = Infinity

  if (LIFETIME_PLANS.has(quota.plan_type)) {
    usedMinutes = await getBillableMinutesUsed(userId)
    limitMinutes = quota.total_trial_minutes_limit + (quota.extra_minutes_balance || 0)
  } else if (MONTHLY_PLANS.has(quota.plan_type) && quota.monthly_minutes_limit != null) {
    const now = new Date()
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString()
    usedMinutes = await getBillableMinutesUsed(userId, { sinceIso: monthStart })
    limitMinutes = quota.monthly_minutes_limit + (quota.extra_minutes_balance || 0)
  }

  if (usedMinutes >= limitMinutes) {
    return {
      allowed: false,
      status: 403,
      body: betaError(
        BETA_ERROR_CODES.BETA_LIMIT_REACHED,
        BETA_LIMIT_MESSAGE,
        { used_minutes: Math.round(usedMinutes), limit_minutes: limitMinutes },
      ),
    }
  }

  return {
    allowed: true,
    maxSessionMinutes: quota.max_live_session_minutes ?? DEFAULT_MAX_LIVE_SESSION_MINUTES,
  }
}

/**
 * Check whether a direct hosted AI action is allowed.
 * This protects endpoints such as /api/transcribe and /api/summarize where
 * there may be no trusted recording duration yet.
 */
export async function checkHostedActionAllowed(quota, userId) {
  if (!quota) {
    return {
      allowed: false,
      status: 503,
      body: betaError(BETA_ERROR_CODES.QUOTA_REQUIRED, 'Beta quota is temporarily unavailable.', {}),
    }
  }

  if (quota.status === 'suspended') {
    return {
      allowed: false,
      status: 403,
      body: betaError(BETA_ERROR_CODES.SUSPENDED, BETA_LIMIT_MESSAGE, {}),
    }
  }

  if (quota.plan_type === 'admin') return { allowed: true }

  const todayCount = await getDailyRecordingCount(userId)
  if (todayCount >= quota.max_recordings_per_day) {
    return {
      allowed: false,
      status: 429,
      body: betaError(
        BETA_ERROR_CODES.DAILY_LIMIT_REACHED,
        `You've reached ${quota.max_recordings_per_day} processed recordings today. ${BETA_LIMIT_MESSAGE}`,
        { used_today: todayCount, limit_today: quota.max_recordings_per_day },
      ),
    }
  }

  let usedMinutes = 0
  let limitMinutes = Infinity
  if (LIFETIME_PLANS.has(quota.plan_type)) {
    usedMinutes = await getBillableMinutesUsed(userId)
    limitMinutes = quota.total_trial_minutes_limit + (quota.extra_minutes_balance || 0)
  } else if (MONTHLY_PLANS.has(quota.plan_type) && quota.monthly_minutes_limit != null) {
    const now = new Date()
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString()
    usedMinutes = await getBillableMinutesUsed(userId, { sinceIso: monthStart })
    limitMinutes = quota.monthly_minutes_limit + (quota.extra_minutes_balance || 0)
  }

  if (usedMinutes >= limitMinutes) {
    return {
      allowed: false,
      status: 403,
      body: betaError(
        BETA_ERROR_CODES.BETA_LIMIT_REACHED,
        BETA_LIMIT_MESSAGE,
        { used_minutes: Math.round(usedMinutes), limit_minutes: limitMinutes },
      ),
    }
  }

  return { allowed: true }
}

// ── Usage recording ────────────────────────────────────────────────────────────

/**
 * Record a beta usage event. Best-effort — never throws.
 * @param {string} userId
 * @param {string} email
 * @param {string|null} recordingId
 * @param {string} actionType
 * @param {number} durationSec
 */
export async function recordBetaUsage(userId, email, recordingId, actionType, durationSec = 0) {
  const db = getAdminClient()
  if (!db) return
  const BILLABLE_ACTIONS = new Set(['process_recording', 'regenerate_summary'])
  const billableMinutes = BILLABLE_ACTIONS.has(actionType)
    ? Math.ceil((durationSec || 0) / 60)
    : 0
  try {
    const { error } = await db.from('beta_usage').insert({
      user_id: userId,
      email: (email || '').toLowerCase(),
      recording_id: recordingId || null,
      action_type: actionType,
      duration_sec: Math.round(durationSec) || 0,
      billable_minutes: billableMinutes,
    })
    if (error) {
      console.warn(
        '[betaGate] recordBetaUsage error',
        JSON.stringify({ error: error.message, actionType, userIdPrefix: userId.slice(0, 8) }),
      )
    }
  } catch (e) {
    console.warn('[betaGate] recordBetaUsage threw', e?.message)
  }
}
