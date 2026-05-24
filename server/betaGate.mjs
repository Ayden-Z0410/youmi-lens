/**
 * Youmi Lens Beta Gate — server-side quota enforcement.
 *
 * Plan tiers:
 *   public_trial  — free public beta: 2 recordings/day, 20 min/recording, 2400 min lifetime backstop, 10 min live session
 *   core_tester   — 1000 min/month, 120 min/recording, 20/day, 120 min live session
 *   student_basic — 200 min/month, 60 min/recording, 10/day, 60 min live session
 *   student_plus  — 600 min/month, 120 min/recording, 20/day, 120 min live session
 *   student_pro   — 1500 min/month, 180 min/recording, 50/day, 180 min live session
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
  'Free beta limit reached. Please contact support for more beta access.'

/** Shown when an account has been put on hold by an admin (status = suspended). */
export const SUSPENDED_MESSAGE =
  'Your account is currently on hold. Please contact support for help.'

export const BETA_ERROR_CODES = {
  AUTH_REQUIRED: 'auth_required',
  QUOTA_REQUIRED: 'quota_required',
  BETA_LIMIT_REACHED: 'beta_limit_reached',
  RECORDING_TOO_LONG: 'recording_too_long',
  DAILY_LIMIT_REACHED: 'daily_recording_limit_reached',
  SUSPENDED: 'quota_suspended',
}

/**
 * Default limits for new public_trial (free public beta) users.
 *
 * V1 public beta allowance: 2 recordings/day, 20 min per recording. The daily
 * recording count is the real gate; the lifetime minute cap is only a generous
 * abuse backstop (≈60 days of max daily use) so it never blocks normal beta
 * testers. All values are overridable via env for testing.
 */
const DEFAULT_TRIAL_MINUTES = Number(process.env.BETA_MAX_TRIAL_MINUTES || 2400)
const DEFAULT_MAX_RECORDING_MINUTES = Number(process.env.BETA_MAX_RECORDING_MINUTES || 20)
const DEFAULT_MAX_RECORDINGS_PER_DAY = Number(process.env.BETA_MAX_RECORDINGS_PER_DAY || 2)
const DEFAULT_MAX_LIVE_SESSION_MINUTES = Number(process.env.BETA_MAX_LIVE_SESSION_MINUTES || 10)

export const PAID_PLAN_LIMITS = {
  student_basic: {
    monthly_minutes_limit: 200,
    max_recording_minutes: 60,
    max_recordings_per_day: 10,
    max_live_session_minutes: 60,
  },
  student_plus: {
    monthly_minutes_limit: 600,
    max_recording_minutes: 120,
    max_recordings_per_day: 20,
    max_live_session_minutes: 120,
  },
  student_pro: {
    monthly_minutes_limit: 1500,
    max_recording_minutes: 180,
    max_recordings_per_day: 50,
    max_live_session_minutes: 180,
  },
}

export const PAID_PLAN_PRIORITY = {
  student_basic: 1,
  student_plus: 2,
  student_pro: 3,
}

/** Plans that use monthly quota (calendar-month reset). */
const MONTHLY_PLANS = new Set(['core_tester', ...Object.keys(PAID_PLAN_LIMITS)])
/** Plans that use lifetime quota (never resets). */
const LIFETIME_PLANS = new Set(['public_trial'])

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

// ── App Store entitlement reconciliation ───────────────────────────────────────

function publicTrialQuotaPatch() {
  return {
    plan_type: 'public_trial',
    total_trial_minutes_limit: DEFAULT_TRIAL_MINUTES,
    monthly_minutes_limit: null,
    max_recording_minutes: DEFAULT_MAX_RECORDING_MINUTES,
    max_recordings_per_day: DEFAULT_MAX_RECORDINGS_PER_DAY,
    max_live_session_minutes: DEFAULT_MAX_LIVE_SESSION_MINUTES,
    status: 'active',
  }
}

function subscriptionPlanType(row) {
  return row?.plan_type ?? row?.planType ?? null
}

function subscriptionExpiresMs(row) {
  const expiresAt = row?.expires_at ?? row?.expiresAt ?? null
  if (!expiresAt) return Infinity
  const parsed = Date.parse(expiresAt)
  return Number.isFinite(parsed) ? parsed : -Infinity
}

export function highestActivePaidPlanType(subscriptions = [], now = new Date()) {
  const nowMs = now.getTime()
  return (subscriptions ?? []).reduce((best, row) => {
    const planType = subscriptionPlanType(row)
    if (!PAID_PLAN_LIMITS[planType]) return best
    if (row?.status !== 'active') return best
    if (subscriptionExpiresMs(row) <= nowMs) return best
    if (!best) return planType
    return PAID_PLAN_PRIORITY[planType] > PAID_PLAN_PRIORITY[best] ? planType : best
  }, null)
}

async function getActivePaidPlanTypeFromLedger(db, userId) {
  const { data, error } = await db
    .from('app_store_subscriptions')
    .select('plan_type,status,expires_at')
    .eq('user_id', userId)
    .in('plan_type', Object.keys(PAID_PLAN_LIMITS))
  if (error) throw error
  return highestActivePaidPlanType(data)
}

async function updateQuotaPlan(db, quota, planType, email) {
  const patch = quotaPatchForPlan(planType)
  if (quota?.status === 'suspended' && planType === 'public_trial') {
    delete patch.status
  }
  if (email) patch.email = email.toLowerCase()

  const { data, error } = await db
    .from('user_quota')
    .update(patch)
    .eq('user_id', quota.user_id)
    .select('*')
    .maybeSingle()
  if (error) throw error
  return data || { ...quota, ...patch }
}

async function reconcilePaidQuotaWithAppStore(db, quota) {
  if (!db || !quota || !PAID_PLAN_LIMITS[quota.plan_type]) return quota
  const activePlanType = await getActivePaidPlanTypeFromLedger(db, quota.user_id)
  const targetPlanType = activePlanType ?? 'public_trial'
  if (targetPlanType === quota.plan_type) return quota
  return updateQuotaPlan(db, quota, targetPlanType, quota.email)
}

export async function syncQuotaToActiveAppStorePlan(db, userId, email = '') {
  if (!db) return null
  const quota = await getOrCreateUserQuota(userId, email)
  if (!quota) return null

  const activePlanType = await getActivePaidPlanTypeFromLedger(db, userId)
  const targetPlanType = activePlanType ?? (PAID_PLAN_LIMITS[quota.plan_type] ? 'public_trial' : quota.plan_type)
  if (targetPlanType === quota.plan_type && (!email || quota.email === email.toLowerCase())) {
    return quota
  }
  return updateQuotaPlan(db, quota, targetPlanType, email)
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

  if (existing) {
    try {
      return await reconcilePaidQuotaWithAppStore(db, existing)
    } catch (err) {
      console.warn(
        '[betaGate] app_store_quota_reconcile_failed',
        JSON.stringify({
          userIdPrefix: userId.slice(0, 8),
          message: err instanceof Error ? err.message : String(err),
        }),
      )
      return existing
    }
  }

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

export function quotaPatchForPlan(planType) {
  if (planType === 'public_trial') return publicTrialQuotaPatch()
  const limits = PAID_PLAN_LIMITS[planType]
  if (!limits) return { plan_type: planType }
  return {
    plan_type: planType,
    monthly_minutes_limit: limits.monthly_minutes_limit,
    max_recording_minutes: limits.max_recording_minutes,
    max_recordings_per_day: limits.max_recordings_per_day,
    max_live_session_minutes: limits.max_live_session_minutes,
    status: 'active',
  }
}

function planLimit(quota, key) {
  return PAID_PLAN_LIMITS[quota?.plan_type]?.[key] ?? quota?.[key]
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
      body: betaError(BETA_ERROR_CODES.SUSPENDED, SUSPENDED_MESSAGE, {}),
    }
  }

  if (quota.plan_type === 'admin') return { allowed: true }

  const maxRecordingMinutes = Number(planLimit(quota, 'max_recording_minutes') ?? DEFAULT_MAX_RECORDING_MINUTES)
  const maxSec = maxRecordingMinutes * 60
  if (durationSec > maxSec) {
    return {
      allowed: false,
      status: 403,
      body: betaError(
        BETA_ERROR_CODES.RECORDING_TOO_LONG,
        `This plan is limited to ${maxRecordingMinutes} minutes per recording. This recording is about ${Math.ceil(durationSec / 60)} minutes — please record a shorter session.`,
        {
          recording_minutes: Math.ceil(durationSec / 60),
          limit_minutes: maxRecordingMinutes,
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
      body: betaError(BETA_ERROR_CODES.SUSPENDED, SUSPENDED_MESSAGE, {}),
    }
  }

  if (quota.plan_type === 'admin') return { allowed: true }

  // Per-recording duration check
  const maxRecordingMinutes = Number(planLimit(quota, 'max_recording_minutes') ?? DEFAULT_MAX_RECORDING_MINUTES)
  const maxSec = maxRecordingMinutes * 60
  if (durationSec > maxSec) {
    return {
      allowed: false,
      status: 403,
      body: betaError(
        BETA_ERROR_CODES.RECORDING_TOO_LONG,
        `This plan is limited to ${maxRecordingMinutes} minutes per recording. This recording is about ${Math.ceil(durationSec / 60)} minutes — please record a shorter session.`,
        {
          recording_minutes: Math.ceil(durationSec / 60),
          limit_minutes: maxRecordingMinutes,
        },
      ),
    }
  }

  // Daily count check
  const todayCount = await getDailyRecordingCount(userId)
  const maxRecordingsPerDay = Number(planLimit(quota, 'max_recordings_per_day') ?? DEFAULT_MAX_RECORDINGS_PER_DAY)
  if (todayCount >= maxRecordingsPerDay) {
    return {
      allowed: false,
      status: 429,
      body: betaError(
        BETA_ERROR_CODES.DAILY_LIMIT_REACHED,
        `Daily limit reached. You can process up to ${maxRecordingsPerDay} lectures per day on this plan.`,
        { used_today: todayCount, limit_today: maxRecordingsPerDay },
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
  } else if (MONTHLY_PLANS.has(quota.plan_type)) {
    const now = new Date()
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString()
    usedMinutes = await getBillableMinutesUsed(userId, { sinceIso: monthStart })
    limitMinutes = Number(planLimit(quota, 'monthly_minutes_limit') ?? Infinity) + (quota.extra_minutes_balance || 0)
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
      body: betaError(BETA_ERROR_CODES.SUSPENDED, SUSPENDED_MESSAGE, {}),
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
  } else if (MONTHLY_PLANS.has(quota.plan_type)) {
    const now = new Date()
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString()
    usedMinutes = await getBillableMinutesUsed(userId, { sinceIso: monthStart })
    limitMinutes = Number(planLimit(quota, 'monthly_minutes_limit') ?? Infinity) + (quota.extra_minutes_balance || 0)
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
    maxSessionMinutes: planLimit(quota, 'max_live_session_minutes') ?? DEFAULT_MAX_LIVE_SESSION_MINUTES,
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
      body: betaError(BETA_ERROR_CODES.SUSPENDED, SUSPENDED_MESSAGE, {}),
    }
  }

  if (quota.plan_type === 'admin') return { allowed: true }

  const todayCount = await getDailyRecordingCount(userId)
  const maxRecordingsPerDay = Number(planLimit(quota, 'max_recordings_per_day') ?? DEFAULT_MAX_RECORDINGS_PER_DAY)
  if (todayCount >= maxRecordingsPerDay) {
    return {
      allowed: false,
      status: 429,
      body: betaError(
        BETA_ERROR_CODES.DAILY_LIMIT_REACHED,
        `Daily limit reached. You can process up to ${maxRecordingsPerDay} lectures per day on this plan.`,
        { used_today: todayCount, limit_today: maxRecordingsPerDay },
      ),
    }
  }

  let usedMinutes = 0
  let limitMinutes = Infinity
  if (LIFETIME_PLANS.has(quota.plan_type)) {
    usedMinutes = await getBillableMinutesUsed(userId)
    limitMinutes = quota.total_trial_minutes_limit + (quota.extra_minutes_balance || 0)
  } else if (MONTHLY_PLANS.has(quota.plan_type)) {
    const now = new Date()
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString()
    usedMinutes = await getBillableMinutesUsed(userId, { sinceIso: monthStart })
    limitMinutes = Number(planLimit(quota, 'monthly_minutes_limit') ?? Infinity) + (quota.extra_minutes_balance || 0)
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
