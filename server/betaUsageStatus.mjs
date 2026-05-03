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
} from './betaGate.mjs'

const DISPLAY_NAMES = {
  public_trial: 'Public Beta Trial',
  core_tester: 'Core Tester',
  admin: 'Developer Mode',
}

function roundMinutes(value) {
  return Math.round(Number(value || 0) * 10) / 10
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

  if (planType === 'core_tester') {
    const usedMinutes = await getUsedMinutes(user.userId, quota)
    const limitMinutes = (quota.monthly_minutes_limit ?? 1000) + (quota.extra_minutes_balance ?? 0)
    const remainingMinutes = Math.max(0, limitMinutes - usedMinutes)

    res.json({
      email: user.email,
      plan_type: planType,
      display_name: displayName,
      used_minutes_this_month: roundMinutes(usedMinutes),
      monthly_minutes_limit: limitMinutes,
      remaining_minutes_this_month: roundMinutes(remainingMinutes),
      recordings_today: recordingsToday,
      daily_recording_limit: quota.max_recordings_per_day ?? 20,
      max_recording_minutes: quota.max_recording_minutes ?? 120,
      max_live_session_minutes: quota.max_live_session_minutes ?? 120,
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
