import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NotificationTypeV2 } from '@apple/app-store-server-library'
import { PLAN_LIMITS } from './betaGate.mjs'
import { billingEventTypeForRevokingNotification } from './iapRoutes.mjs'

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

describe('Student Pass quota defaults', () => {
  it('uses the locked server-side Student Pass defaults', () => {
    expect(PLAN_LIMITS.student_pass).toMatchObject({
      monthly_minutes_limit: 600,
      daily_minutes_limit: 120,
      max_recording_minutes: 90,
      max_live_session_minutes: 90,
      max_recordings_per_day: 6,
      max_processing_jobs_per_day: 10,
    })
  })
})

describe('App Store notification behavior', () => {
  it('maps refund and revoke notifications to billing events', () => {
    expect(billingEventTypeForRevokingNotification(NotificationTypeV2.REFUND)).toBe('refund')
    expect(billingEventTypeForRevokingNotification(NotificationTypeV2.REVOKE)).toBe('revoke')
  })
})

describe('Phase 2 active path guarantees', () => {
  it('account deletion no longer references app_store_subscriptions', () => {
    const source = read('./accountRoutes.mjs')
    expect(source).not.toContain("'app_store_subscriptions'")
    expect(source).not.toContain('"app_store_subscriptions"')
  })

  it('account deletion marks Apple transactions instead of deleting history', () => {
    const source = read('./accountRoutes.mjs')
    expect(source).toContain("from('apple_iap_transactions')")
    expect(source).toContain("owner_state: 'account_deleted'")
    expect(source).not.toMatch(/deleteRows\(db,\s*['"]apple_iap_transactions/)
  })

  it('/api/live-transcribe-url uses effective quota gates and usage accounting', () => {
    const source = read('./liveTranscribeFromUrl.mjs')
    expect(source).toContain('getEffectiveQuota')
    expect(source).toContain('checkLiveSessionAllowed')
    expect(source).toContain('recordBetaUsage')
  })

  it('/api/beta-usage-status resolves effective quota instead of stored plan only', () => {
    const source = read('./betaUsageStatus.mjs')
    expect(source).toContain('getEffectiveQuota(user.userId, user.email)')
    expect(source).not.toContain('const quota = await getOrCreateUserQuota(user.userId, user.email)')
  })

  it('/api/iap/entitlement returns safe inactive Student Pass status', () => {
    const source = read('./iapRoutes.mjs')
    expect(source).toContain('getLatestStudentPassEntitlement(db, user.userId)')
    expect(source).toContain("status: 'none'")
    expect(source).toContain('latestEntitlement: safeEntitlementSnapshot(latestEntitlement)')
    expect(source).toContain('currentEntitlement: null')
    expect(source).not.toContain('linked to a deleted Youmi Lens account')
  })
})
