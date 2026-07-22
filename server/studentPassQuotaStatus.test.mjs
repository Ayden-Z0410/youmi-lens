import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PLAN_LIMITS } from './betaGate.mjs'
import {
  getActiveEntitlement,
  isEntitlementActive,
  resolveEffectivePlanType,
  STUDENT_BASIC_PRODUCT_ID,
} from './iapEntitlements.mjs'

function entitlementQuery(result) {
  const filters = []
  const query = {
    select() { return this },
    eq(column, value) { filters.push(['eq', column, value]); return this },
    in(column, value) { filters.push(['in', column, value]); return this },
    lte(column, value) { filters.push(['lte', column, value]); return this },
    gt(column, value) { filters.push(['gt', column, value]); return this },
    is(column, value) { filters.push(['is', column, value]); return this },
    order() { return this },
    limit() { return this },
    async maybeSingle() { return { data: result, error: null } },
  }
  return {
    db: {
      from(table) {
        expect(table).toBe('user_entitlements')
        return query
      },
    },
    filters,
  }
}

describe('Student Pass quota entitlement lookup', () => {
  it('uses source-agnostic active Student Pass window and revocation filters', async () => {
    const row = {
      product_id: STUDENT_BASIC_PRODUCT_ID,
      plan_type: 'student_pass',
      starts_at: '2026-06-11T03:04:18.000Z',
      expires_at: '2026-07-11T03:04:18.000Z',
      status: 'active',
      revoked_at: null,
    }
    const { db, filters } = entitlementQuery(row)
    const nowIso = '2026-06-11T04:00:00.000Z'

    await expect(getActiveEntitlement(db, 'user-1', nowIso)).resolves.toEqual(row)
    // Commercialization V2 · 1A: resolution keys off plan_type only so an Apple
    // OR Stripe grant resolves identically. There must be NO product_id filter.
    expect(filters).toEqual([
      ['eq', 'user_id', 'user-1'],
      ['eq', 'plan_type', 'student_pass'],
      ['eq', 'status', 'active'],
      ['lte', 'starts_at', nowIso],
      ['gt', 'expires_at', nowIso],
      ['is', 'revoked_at', null],
    ])
    expect(filters.some(([, column]) => column === 'product_id')).toBe(false)
  })

  it('resolves a Stripe-sourced active Student Pass grant (no Apple product id)', async () => {
    const stripeRow = {
      product_id: 'student_basic_monthly',
      plan_type: 'student_pass',
      starts_at: '2026-06-11T03:04:18.000Z',
      expires_at: '2026-07-11T03:04:18.000Z',
      status: 'active',
      revoked_at: null,
    }
    const { db } = entitlementQuery(stripeRow)
    await expect(
      getActiveEntitlement(db, 'user-1', '2026-06-11T04:00:00.000Z'),
    ).resolves.toEqual(stripeRow)
  })

  it('restricts resolution to plan_type=student_pass, status=active, and revoked_at IS NULL', async () => {
    const { db, filters } = entitlementQuery(null)
    await getActiveEntitlement(db, 'user-1', '2026-06-11T04:00:00.000Z')
    expect(filters).toContainEqual(['eq', 'plan_type', 'student_pass'])
    expect(filters).toContainEqual(['eq', 'status', 'active'])
    expect(filters).toContainEqual(['is', 'revoked_at', null])
    // Window bounds are enforced in the query itself.
    expect(filters.some(([op, col]) => op === 'lte' && col === 'starts_at')).toBe(true)
    expect(filters.some(([op, col]) => op === 'gt' && col === 'expires_at')).toBe(true)
  })
})

describe('entitlement activeness rules (source-agnostic)', () => {
  const base = {
    plan_type: 'student_pass',
    starts_at: '2026-06-01T00:00:00Z',
    expires_at: '2026-07-01T00:00:00Z',
    status: 'active',
    revoked_at: null,
  }
  const inWindow = Date.parse('2026-06-15T00:00:00Z')

  it('an active in-window entitlement is active (Apple or Stripe alike)', () => {
    expect(isEntitlementActive(base, inWindow)).toBe(true)
  })

  it('an expired entitlement is not active', () => {
    expect(isEntitlementActive(base, Date.parse('2026-07-02T00:00:00Z'))).toBe(false)
  })

  it('a future-dated entitlement is not active', () => {
    expect(isEntitlementActive(base, Date.parse('2026-05-01T00:00:00Z'))).toBe(false)
  })

  it('a revoked entitlement is not active', () => {
    expect(isEntitlementActive({ ...base, status: 'revoked', revoked_at: '2026-06-10T00:00:00Z' }, inWindow)).toBe(false)
    expect(isEntitlementActive({ ...base, revoked_at: '2026-06-10T00:00:00Z' }, inWindow)).toBe(false)
  })

  it('resolves student_pass only from an active entitlement, else falls back', () => {
    expect(resolveEffectivePlanType({ storedPlanType: 'public_trial', entitlement: base, nowMs: inWindow })).toBe('student_pass')
    expect(
      resolveEffectivePlanType({ storedPlanType: 'public_trial', entitlement: base, nowMs: Date.parse('2026-07-02T00:00:00Z') }),
    ).toBe('public_trial')
  })

  it('database CHECK forbids a source-less entitlement (migration guarantees identity)', () => {
    const migration = readFileSync(
      new URL('../supabase-migration-stripe-desktop-subscriptions.sql', import.meta.url),
      'utf8',
    )
    expect(migration).toContain('user_entitlements_source_present_check')
    expect(migration).toMatch(/provider = 'apple'\s+AND source_transaction_id IS NOT NULL/)
    expect(migration).toMatch(/provider = 'stripe' AND provider_ref IS NOT NULL/)
  })

  it('exposes the explicit Student Pass status and quota response fields', () => {
    const source = readFileSync(new URL('./betaUsageStatus.mjs', import.meta.url), 'utf8')
    expect(source).toContain('studentPassActive')
    expect(source).toContain('studentPassExpiry')
    expect(source).toContain('effectivePlanType')
    expect(source).toContain('monthly_minutes:')
    expect(source).toContain('processing_jobs_per_day:')
  })

  it('keeps free and active Student Pass response quotas distinct', () => {
    expect(PLAN_LIMITS.public_trial).toMatchObject({
      monthly_minutes_limit: 300,
      daily_minutes_limit: 120,
      max_recording_minutes: 60,
      max_live_session_minutes: 60,
      max_recordings_per_day: 2,
      max_processing_jobs_per_day: 2,
    })
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
