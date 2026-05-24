import { describe, expect, it } from 'vitest'
import {
  highestActivePaidPlanType,
  quotaPatchForPlan,
} from '../../server/betaGate.mjs'

describe('App Store entitlement quota policy', () => {
  it('chooses the highest unexpired active paid subscription', () => {
    const now = new Date('2026-05-24T12:00:00.000Z')

    expect(
      highestActivePaidPlanType(
        [
          {
            plan_type: 'student_pro',
            status: 'active',
            expires_at: '2026-05-24T11:59:59.000Z',
          },
          {
            plan_type: 'student_plus',
            status: 'active',
            expires_at: '2026-06-24T12:00:00.000Z',
          },
          {
            plan_type: 'student_basic',
            status: 'revoked',
            expires_at: '2026-06-24T12:00:00.000Z',
          },
        ],
        now,
      ),
    ).toBe('student_plus')
  })

  it('returns no paid plan when every subscription is inactive or expired', () => {
    const now = new Date('2026-05-24T12:00:00.000Z')

    expect(
      highestActivePaidPlanType(
        [
          {
            plan_type: 'student_pro',
            status: 'expired',
            expires_at: '2026-06-24T12:00:00.000Z',
          },
          {
            plan_type: 'student_plus',
            status: 'active',
            expires_at: '2026-05-24T12:00:00.000Z',
          },
        ],
        now,
      ),
    ).toBeNull()
  })

  it('resets paid limits when downgrading back to public trial', () => {
    expect(quotaPatchForPlan('public_trial')).toMatchObject({
      plan_type: 'public_trial',
      total_trial_minutes_limit: 2400,
      monthly_minutes_limit: null,
      max_recording_minutes: 20,
      max_recordings_per_day: 2,
      max_live_session_minutes: 10,
      status: 'active',
    })
  })
})
