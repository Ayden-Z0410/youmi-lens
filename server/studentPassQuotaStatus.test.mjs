import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { getActiveEntitlement, STUDENT_PASS_PRODUCT_ID } from './iapEntitlements.mjs'

function entitlementQuery(result) {
  const filters = []
  const query = {
    select() { return this },
    eq(column, value) { filters.push(['eq', column, value]); return this },
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
  it('uses the exact active Student Pass window and revocation filters', async () => {
    const row = {
      product_id: STUDENT_PASS_PRODUCT_ID,
      plan_type: 'student_pass',
      starts_at: '2026-06-11T03:04:18.000Z',
      expires_at: '2026-07-11T03:04:18.000Z',
      status: 'active',
      revoked_at: null,
    }
    const { db, filters } = entitlementQuery(row)
    const nowIso = '2026-06-11T04:00:00.000Z'

    await expect(getActiveEntitlement(db, 'user-1', nowIso)).resolves.toEqual(row)
    expect(filters).toEqual([
      ['eq', 'user_id', 'user-1'],
      ['eq', 'product_id', STUDENT_PASS_PRODUCT_ID],
      ['eq', 'plan_type', 'student_pass'],
      ['eq', 'status', 'active'],
      ['lte', 'starts_at', nowIso],
      ['gt', 'expires_at', nowIso],
      ['is', 'revoked_at', null],
    ])
  })

  it('exposes the explicit Student Pass status and quota response fields', () => {
    const source = readFileSync(new URL('./betaUsageStatus.mjs', import.meta.url), 'utf8')
    expect(source).toContain('studentPassActive')
    expect(source).toContain('studentPassExpiry')
    expect(source).toContain('effectivePlanType')
    expect(source).toContain('monthly_minutes:')
    expect(source).toContain('processing_jobs_per_day:')
  })
})
