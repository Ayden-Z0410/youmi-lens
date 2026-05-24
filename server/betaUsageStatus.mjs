/**
 * GET /api/beta-usage-status
 * Returns the authenticated user's current beta plan and usage status.
 * Requires Supabase JWT (Bearer token).
 */

import {
  verifyJwt,
  getOrCreateUserQuota,
  getUsedMinutes,
  getDailyCount,
  BETA_ERROR_CODES,
  PAID_PLAN_LIMITS,
} from './betaGate.mjs'

const DISPLAY_NAMES = {
  public_trial: 'Public Beta Trial',
  core_tester: 'Core Tester',
  student_basic: 'Youmi Lens Basic',
  student_plus: 'Youmi Lens Plus',
  student_pro: 'Youmi Lens Pro',
  admin: 'Developer Mode',
}

function roundMinutes(value) {
  return Math.round(Number(value || 0) * 10) / 10
}

function planLimit(quota, key) {
  return PAID_PLAN_LIMITS[quota?.plan_type]?.[key] ?? quota?.[key]
}

export async function handleBetaUsageStatus(req, res) {
  // Auth
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) {
    res.status(401).json({ error: BETA_ERROR_CODES.AUTH_REQUIRED, message: 'Sign in required.' })
    return
  }
  const user = await verifyJwt(token)
  if (!user) {
    res.status(401).json({ error: BETA_ERROR_CODES.AUTH_REQUIRED, message: 'Invalid or expired session.' })
    return
  }

  const quota = await getOrCreateUserQuota(user.userId, user.email)
  if (!quota) {
    res.status(503).json({ error: BETA_ERROR_CODES.QUOTA_REQUIRED, message: 'Beta quota temporarily unavailable.' })
    return
  }

  const planType = quota.plan_type || 'public_trial'
  const displayName = DISPLAY_NAMES[planType] ?? planType

  // Admin: no usage tracking
  if (planType === 'admin') {
    res.json({
      email: user.email,
      plan_type: planType,
      display_name: displayName,
      limits_bypassed: true,
      message: 'Usage limits are bypassed for this account.',
    })
    return
  }

  const recordingsToday = await getDailyCount(user.userId)

  if (planType === 'public_trial') {
    const usedMinutes = await getUsedMinutes(user.userId, quota)
    const limitMinutes = (quota.total_trial_minutes_limit ?? 20) + (quota.extra_minutes_balance ?? 0)
    const remainingMinutes = Math.max(0, limitMinutes - usedMinutes)

    res.json({
      email: user.email,
      plan_type: planType,
      display_name: displayName,
      used_minutes: roundMinutes(usedMinutes),
      limit_minutes: limitMinutes,
      remaining_minutes: roundMinutes(remainingMinutes),
      recordings_today: recordingsToday,
      daily_recording_limit: quota.max_recordings_per_day ?? 10,
      max_recording_minutes: quota.max_recording_minutes ?? 10,
      max_live_session_minutes: quota.max_live_session_minutes ?? 10,
    })
    return
  }

  if (planType === 'core_tester' || PAID_PLAN_LIMITS[planType]) {
    const usedMinutes = await getUsedMinutes(user.userId, quota)
    const limitMinutes =
      (planLimit(quota, 'monthly_minutes_limit') ?? 1000) + (quota.extra_minutes_balance ?? 0)
    const remainingMinutes = Math.max(0, limitMinutes - usedMinutes)

    res.json({
      email: user.email,
      plan_type: planType,
      display_name: displayName,
      used_minutes_this_month: roundMinutes(usedMinutes),
      monthly_minutes_limit: limitMinutes,
      remaining_minutes_this_month: roundMinutes(remainingMinutes),
      recordings_today: recordingsToday,
      daily_recording_limit: planLimit(quota, 'max_recordings_per_day') ?? 20,
      max_recording_minutes: planLimit(quota, 'max_recording_minutes') ?? 120,
      max_live_session_minutes: planLimit(quota, 'max_live_session_minutes') ?? 120,
    })
    return
  }

  // Unknown plans are treated like public trial in the existing gate logic.
  const usedMinutes = await getUsedMinutes(user.userId, { ...quota, plan_type: 'public_trial' })
  const limitMinutes = (quota.total_trial_minutes_limit ?? 20) + (quota.extra_minutes_balance ?? 0)
  const remainingMinutes = Math.max(0, limitMinutes - usedMinutes)
  res.json({
    email: user.email,
    plan_type: planType,
    display_name: DISPLAY_NAMES.public_trial,
    used_minutes: roundMinutes(usedMinutes),
    limit_minutes: limitMinutes,
    remaining_minutes: roundMinutes(remainingMinutes),
    recordings_today: recordingsToday,
    daily_recording_limit: quota.max_recordings_per_day ?? 10,
    max_recording_minutes: quota.max_recording_minutes ?? 10,
    max_live_session_minutes: quota.max_live_session_minutes ?? 10,
  })
}

// ── GET /api/quota/status ────────────────────────────────────────────────────
// Live plan + quota for the iPad Settings screen. Normalized camelCase shape,
// secret-free. Distinct from /api/beta-usage-status (kept for the macOS app).

/** plan_type → user-facing plan name shown in Settings. */
const QUOTA_PLAN_DISPLAY_NAMES = {
  admin: 'Developer',
  developer: 'Developer',
  core_tester: 'Tester',
  student_basic: 'Youmi Lens Basic',
  student_plus: 'Youmi Lens Plus',
  student_pro: 'Youmi Lens Pro',
  public_trial: 'Free Beta',
}

/** Plans that bypass all quota limits. */
const UNLIMITED_PLAN_TYPES = new Set(['admin', 'developer'])

/**
 * GET /api/quota/status
 * Returns the authenticated user's live plan + quota in a normalized,
 * secret-free shape. Requires a Supabase JWT (Bearer token). A missing
 * user_quota row is auto-created as public_trial by getOrCreateUserQuota.
 */
export async function buildQuotaStatus(userId, email) {
  const quota = await getOrCreateUserQuota(userId, email)
  if (!quota) return null

  const planType = quota.plan_type || 'public_trial'
  const displayName = QUOTA_PLAN_DISPLAY_NAMES[planType] ?? QUOTA_PLAN_DISPLAY_NAMES.public_trial
  const status = quota.status === 'suspended' ? 'suspended' : 'active'

  // Developer / admin: unlimited — no usage counters to report.
  if (UNLIMITED_PLAN_TYPES.has(planType)) {
    return { planType, displayName, status, unlimited: true }
  }

  // Limited tiers: report live daily + minute usage from the existing helpers.
  const recordingsUsedToday = await getDailyCount(userId)
  const maxRecordingsPerDay = Number(planLimit(quota, 'max_recordings_per_day') ?? 0)
  const maxRecordingMinutes = Number(planLimit(quota, 'max_recording_minutes') ?? 0)
  const extraMinutesBalance = Number(quota.extra_minutes_balance ?? 0)

  const isMonthly = planType === 'core_tester' || Boolean(PAID_PLAN_LIMITS[planType])
  const minutesUsed = await getUsedMinutes(
    userId,
    isMonthly ? quota : { ...quota, plan_type: 'public_trial' },
  )
  const baseMinutesLimit = isMonthly
    ? planLimit(quota, 'monthly_minutes_limit')
    : quota.total_trial_minutes_limit
  const minutesLimit = baseMinutesLimit == null ? null : Number(baseMinutesLimit) + extraMinutesBalance

  return {
    planType,
    displayName,
    status,
    unlimited: false,
    maxRecordingsPerDay,
    recordingsUsedToday,
    recordingsRemainingToday: Math.max(0, maxRecordingsPerDay - recordingsUsedToday),
    maxRecordingMinutes,
    totalTrialMinutesLimit:
      quota.total_trial_minutes_limit == null ? null : Number(quota.total_trial_minutes_limit),
    monthlyMinutesLimit:
      planLimit(quota, 'monthly_minutes_limit') == null
        ? null
        : Number(planLimit(quota, 'monthly_minutes_limit')),
    extraMinutesBalance,
    minutesUsed: roundMinutes(minutesUsed),
    minutesLimit,
    minutesRemaining: minutesLimit == null ? null : roundMinutes(Math.max(0, minutesLimit - minutesUsed)),
  }
}

export async function handleQuotaStatus(req, res) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) {
    res.status(401).json({ ok: false, error: BETA_ERROR_CODES.AUTH_REQUIRED, message: 'Sign in required.' })
    return
  }
  const user = await verifyJwt(token)
  if (!user) {
    res.status(401).json({ ok: false, error: BETA_ERROR_CODES.AUTH_REQUIRED, message: 'Invalid or expired session.' })
    return
  }

  const plan = await buildQuotaStatus(user.userId, user.email)
  if (!plan) {
    res.status(503).json({
      ok: false,
      error: BETA_ERROR_CODES.QUOTA_REQUIRED,
      message: 'Plan information is temporarily unavailable.',
    })
    return
  }

  res.json({ ok: true, plan })
}
