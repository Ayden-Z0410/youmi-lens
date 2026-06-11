import { describe, expect, it } from 'vitest'
import {
  computeEntitlementWindow,
  deriveInactiveEntitlementStatus,
  decideGrantWithBinding,
  isEntitlementActive,
  reserveNotification,
  resolveEffectivePlanType,
  safeEntitlementSnapshot,
} from './iapEntitlements.mjs'

const PRODUCT_ID = 'com.aydenz.youmilensipad.studentpass30d'
const PURCHASE_MS = Date.parse('2026-06-10T12:00:00Z')
const CUTOFF = '2026-07-19T00:00:00Z'

function verified(overrides = {}) {
  return {
    productId: PRODUCT_ID,
    transactionId: 'tx-1',
    originalTransactionId: 'orig-1',
    environment: 'Sandbox',
    purchaseDateMs: PURCHASE_MS,
    purchaseDate: new Date(PURCHASE_MS).toISOString(),
    appleExpiresDate: '2099-01-01T00:00:00Z',
    revoked: false,
    ...overrides,
  }
}

function product(overrides = {}) {
  return {
    product_id: PRODUCT_ID,
    plan_type: 'student_pass',
    kind: 'non_renewing',
    entitlement_days: 30,
    is_purchasable: true,
    sales_end_at: CUTOFF,
    ...overrides,
  }
}

describe('Student Pass entitlement decisions', () => {
  it('grants a valid Student Pass transaction with server-computed 30-day expiry', () => {
    const decision = decideGrantWithBinding({
      verified: verified(),
      product: product(),
      binding: null,
      requestingUserId: 'user-1',
      nowMs: Date.parse('2026-06-11T00:00:00Z'),
    })

    expect(decision.ok).toBe(true)
    expect(decision.active).toBe(true)
    expect(decision.window.startsAt).toBe('2026-06-10T12:00:00.000Z')
    expect(decision.window.expiresAt).toBe('2026-07-10T12:00:00.000Z')
  })

  it('ignores Apple expiresDate for access authority', () => {
    const decision = decideGrantWithBinding({
      verified: verified({ appleExpiresDate: '2026-06-10T12:00:01Z' }),
      product: product(),
      binding: null,
      requestingUserId: 'user-1',
      nowMs: Date.parse('2026-06-20T00:00:00Z'),
    })
    expect(decision.active).toBe(true)
    expect(decision.window.expiresAt).toBe('2026-07-10T12:00:00.000Z')
  })

  it('rejects an unknown product id', () => {
    const decision = decideGrantWithBinding({
      verified: verified({ productId: 'unknown.product' }),
      product: null,
      binding: null,
      requestingUserId: 'user-1',
      nowMs: PURCHASE_MS,
    })
    expect(decision.ok).toBe(false)
    expect(decision.code).toBe('unknown_product')
  })

  it('allows duplicate replay by the same account', () => {
    const decision = decideGrantWithBinding({
      verified: verified(),
      product: product(),
      binding: { userId: 'user-1', ownerState: 'active' },
      requestingUserId: 'user-1',
      nowMs: Date.parse('2026-06-11T00:00:00Z'),
    })
    expect(decision.ok).toBe(true)
  })

  it('rejects the same transaction claimed by a second account', () => {
    const decision = decideGrantWithBinding({
      verified: verified(),
      product: product(),
      binding: { userId: 'user-1', ownerState: 'active' },
      requestingUserId: 'user-2',
      nowMs: Date.parse('2026-06-11T00:00:00Z'),
    })
    expect(decision.ok).toBe(false)
    expect(decision.code).toBe('already_linked')
  })

  it('rejects a transaction bound to a deleted account', () => {
    const decision = decideGrantWithBinding({
      verified: verified(),
      product: product(),
      binding: { userId: null, ownerState: 'account_deleted' },
      requestingUserId: 'user-2',
      nowMs: Date.parse('2026-06-11T00:00:00Z'),
    })
    expect(decision.ok).toBe(false)
    expect(decision.code).toBe('account_deleted')
  })

  it('rejects purchases after sales_end_at', () => {
    const decision = decideGrantWithBinding({
      verified: verified({ purchaseDateMs: Date.parse('2026-07-19T00:00:01Z') }),
      product: product(),
      binding: null,
      requestingUserId: 'user-1',
      nowMs: Date.parse('2026-07-19T00:00:02Z'),
    })
    expect(decision.ok).toBe(false)
    expect(decision.code).toBe('sales_closed')
  })

  it('restores a pre-cutoff purchase after is_purchasable=false', () => {
    const decision = decideGrantWithBinding({
      verified: verified({ purchaseDateMs: Date.parse('2026-07-18T23:59:59Z') }),
      product: product({ is_purchasable: false }),
      binding: null,
      requestingUserId: 'user-1',
      nowMs: Date.parse('2026-07-20T00:00:00Z'),
    })
    expect(decision.ok).toBe(true)
    expect(decision.active).toBe(true)
  })

  it('records but does not grant an already expired restored pass', () => {
    const decision = decideGrantWithBinding({
      verified: verified({ purchaseDateMs: Date.parse('2026-06-01T00:00:00Z') }),
      product: product({ is_purchasable: false }),
      binding: null,
      requestingUserId: 'user-1',
      nowMs: Date.parse('2026-07-20T00:00:00Z'),
    })
    expect(decision.ok).toBe(true)
    expect(decision.active).toBe(false)
    expect(decision.entitlementStatus).toBe('expired')
  })
})

describe('effective plan resolution', () => {
  const activeEntitlement = {
    plan_type: 'student_pass',
    starts_at: '2026-06-01T00:00:00Z',
    expires_at: '2026-07-01T00:00:00Z',
    status: 'active',
    revoked_at: null,
  }

  it('falls back to public_trial after entitlement expiry', () => {
    expect(
      resolveEffectivePlanType({
        storedPlanType: 'public_trial',
        entitlement: activeEntitlement,
        nowMs: Date.parse('2026-07-01T00:00:00Z'),
      }),
    ).toBe('public_trial')
  })

  it('keeps admin override above entitlement', () => {
    expect(
      resolveEffectivePlanType({
        storedPlanType: 'admin',
        entitlement: activeEntitlement,
        nowMs: Date.parse('2026-06-10T00:00:00Z'),
      }),
    ).toBe('admin')
  })

  it('lets an active Student Pass override core_tester quota', () => {
    expect(
      resolveEffectivePlanType({
        storedPlanType: 'core_tester',
        entitlement: activeEntitlement,
        nowMs: Date.parse('2026-06-10T00:00:00Z'),
      }),
    ).toBe('student_pass')
  })

  it('recognizes active non-revoked entitlement windows', () => {
    expect(isEntitlementActive(activeEntitlement, Date.parse('2026-06-10T00:00:00Z'))).toBe(true)
  })
})

describe('inactive entitlement status response helpers', () => {
  const inactiveEntitlement = {
    product_id: PRODUCT_ID,
    plan_type: 'student_pass',
    starts_at: '2026-06-01T00:00:00Z',
    expires_at: '2026-07-01T00:00:00Z',
    status: 'active',
    revoked_at: null,
    source_transaction_id: 'tx-1',
  }

  it('formats a safe entitlement snapshot without transaction IDs', () => {
    expect(safeEntitlementSnapshot(inactiveEntitlement)).toEqual({
      productId: PRODUCT_ID,
      planType: 'student_pass',
      startsAt: '2026-06-01T00:00:00Z',
      expiresAt: '2026-07-01T00:00:00Z',
      status: 'active',
    })
  })

  it('reports expired for a known Student Pass outside its window', () => {
    expect(
      deriveInactiveEntitlementStatus(
        inactiveEntitlement,
        null,
        Date.parse('2026-07-02T00:00:00Z'),
      ),
    ).toBe('expired')
  })

  it('reports refunded when the latest revocation event is refund', () => {
    expect(
      deriveInactiveEntitlementStatus(
        { ...inactiveEntitlement, status: 'revoked', revoked_at: '2026-06-15T00:00:00Z' },
        'refund',
        Date.parse('2026-06-16T00:00:00Z'),
      ),
    ).toBe('refunded')
  })

  it('reports revoked for revoke events without exposing ownership details', () => {
    expect(
      deriveInactiveEntitlementStatus(
        { ...inactiveEntitlement, status: 'revoked', revoked_at: '2026-06-15T00:00:00Z' },
        'revoke',
        Date.parse('2026-06-16T00:00:00Z'),
      ),
    ).toBe('revoked')
  })
})

describe('notification idempotency', () => {
  it('reserves notification UUIDs with unique-conflict dedupe', async () => {
    const db = {
      from() {
        return {
          insert(row) {
            return row.notification_uuid === 'dupe'
              ? { error: { code: '23505', message: 'duplicate key' } }
              : { error: null }
          },
          select() {
            return {
              eq() {
                return {
                  maybeSingle() {
                    return { data: { processing_status: 'processed' }, error: null }
                  },
                }
              },
            }
          },
        }
      },
    }

    await expect(reserveNotification(db, { notificationUUID: 'new' })).resolves.toEqual({
      reserved: true,
      notificationUUID: 'new',
    })
    await expect(reserveNotification(db, { notificationUUID: 'dupe' })).resolves.toEqual({
      reserved: false,
      notificationUUID: 'dupe',
    })
  })

  it('allows a failed notification UUID to be retried', async () => {
    const updates = []
    const db = {
      from() {
        return {
          insert() {
            return { error: { code: '23505', message: 'duplicate key' } }
          },
          select() {
            return {
              eq() {
                return {
                  maybeSingle() {
                    return { data: { processing_status: 'failed' }, error: null }
                  },
                }
              },
            }
          },
          update(row) {
            updates.push(row)
            return {
              eq() {
                return {
                  eq() {
                    return { error: null }
                  },
                }
              },
            }
          },
        }
      },
    }

    await expect(reserveNotification(db, { notificationUUID: 'retry' })).resolves.toMatchObject({
      reserved: true,
      retrying: true,
    })
    expect(updates[0]).toMatchObject({ processing_status: 'processing', safe_error: null })
  })
})

describe('window math', () => {
  it('computes starts_at and expires_at from purchaseDate only', () => {
    expect(computeEntitlementWindow(PURCHASE_MS, 30)).toMatchObject({
      startsAt: '2026-06-10T12:00:00.000Z',
      expiresAt: '2026-07-10T12:00:00.000Z',
    })
  })
})
