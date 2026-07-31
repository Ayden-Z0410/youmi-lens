import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyAppleTransaction: vi.fn(),
  findAppleIapTransactionBinding: vi.fn(),
  updateAppleIapTransactionByTransactionId: vi.fn(),
  revokeAppleIapTransaction: vi.fn(),
  insertAppleIapTransaction: vi.fn(),
}))

vi.mock('./iapApple.mjs', () => ({
  verifyAppleTransaction: mocks.verifyAppleTransaction,
  verifyAppleNotification: vi.fn(),
}))

vi.mock('./iapLedger.mjs', () => ({
  isAppleIapLedgerUnavailableError: vi.fn(() => false),
  findAppleIapTransactionBinding: mocks.findAppleIapTransactionBinding,
  insertAppleIapTransaction: mocks.insertAppleIapTransaction,
  updateAppleIapTransactionByTransactionId: mocks.updateAppleIapTransactionByTransactionId,
  revokeAppleIapTransaction: mocks.revokeAppleIapTransaction,
}))

const { verifyAndPersist } = await import('./iapRoutes.mjs')

const PRODUCT_ID = 'com.aydenz.youmilensipad.studentbasic30d'

function createReplayDb() {
  const db = {
    entitlementUpdates: [],
    entitlementFilters: [],
    billingEvents: [],
    from(table) {
      if (table === 'billing_products') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle() {
                    return {
                      data: {
                        product_id: PRODUCT_ID,
                        plan_type: 'student_pass',
                        kind: 'consumable',
                        entitlement_days: 30,
                      },
                      error: null,
                    }
                  },
                }
              },
            }
          },
        }
      }

      if (table === 'user_entitlements') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle() {
                    return {
                      data: {
                        product_id: PRODUCT_ID,
                        plan_type: 'student_pass',
                        starts_at: '2026-06-10T12:00:00.000Z',
                        expires_at: '2026-07-10T12:00:00.000Z',
                        status: 'active',
                        revoked_at: null,
                        source_transaction_id: 'tx-1',
                      },
                      error: null,
                    }
                  },
                }
              },
            }
          },
          update(row) {
            db.entitlementUpdates.push(row)
            return {
              eq(column, value) {
                db.entitlementFilters.push({ column, value })
                return { error: null }
              },
            }
          },
        }
      }

      if (table === 'billing_events') {
        return {
          insert(row) {
            db.billingEvents.push(row)
            return { error: null }
          },
        }
      }

      throw new Error(`Unexpected table ${table}`)
    },
  }
  return db
}

describe('verifyAndPersist replay handling', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('revokes an existing entitlement when a same-user replay verifies as revoked', async () => {
    const revokedAt = '2026-06-20T12:00:00.000Z'
    mocks.verifyAppleTransaction.mockResolvedValue({
      productId: PRODUCT_ID,
      transactionId: 'tx-1',
      originalTransactionId: 'orig-1',
      environment: 'Sandbox',
      purchaseDateMs: Date.parse('2026-06-10T12:00:00Z'),
      purchaseDate: '2026-06-10T12:00:00.000Z',
      appleExpiresDate: null,
      revoked: true,
      revokedAt,
      rawTransaction: { transactionId: 'tx-1', revocationDate: Date.parse(revokedAt) },
    })
    mocks.findAppleIapTransactionBinding.mockResolvedValue({ userId: 'user-1', ownerState: 'active' })
    mocks.updateAppleIapTransactionByTransactionId.mockResolvedValue({ error: null })
    mocks.revokeAppleIapTransaction.mockResolvedValue({ error: null })

    const db = createReplayDb()
    const result = await verifyAndPersist(db, { userId: 'user-1', email: 'student@example.com' }, {
      signedTransactionInfo: 'signed-tx',
    })

    expect(result).toEqual({ granted: false, code: 'revoked' })
    expect(mocks.updateAppleIapTransactionByTransactionId).toHaveBeenCalledWith(
      db,
      'tx-1',
      expect.objectContaining({
        status: 'revoked',
        revoked_at: revokedAt,
      }),
    )
    expect(db.entitlementUpdates).toEqual([{ status: 'revoked', revoked_at: revokedAt }])
    expect(db.entitlementFilters).toEqual([{ column: 'source_transaction_id', value: 'tx-1' }])
    expect(mocks.revokeAppleIapTransaction).toHaveBeenCalledWith(db, 'tx-1', revokedAt)
    expect(db.billingEvents).toContainEqual(expect.objectContaining({
      user_id: 'user-1',
      event_type: 'revoke',
      transaction_id: 'tx-1',
      detail: { source: 'verify_replay' },
    }))
  })
})
