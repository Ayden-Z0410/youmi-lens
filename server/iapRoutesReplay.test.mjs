import { describe, expect, it, vi } from 'vitest'

const {
  findBindingMock,
  insertTxMock,
  revokeTxMock,
  updateTxMock,
  verifyAppleTransactionMock,
} = vi.hoisted(() => ({
  findBindingMock: vi.fn(),
  insertTxMock: vi.fn(),
  revokeTxMock: vi.fn(),
  updateTxMock: vi.fn(),
  verifyAppleTransactionMock: vi.fn(),
}))

vi.mock('./iapApple.mjs', () => ({
  verifyAppleTransaction: verifyAppleTransactionMock,
}))

vi.mock('./iapLedger.mjs', () => ({
  findAppleIapTransactionBinding: findBindingMock,
  insertAppleIapTransaction: insertTxMock,
  isAppleIapLedgerUnavailableError: (err) => err?.name === 'AppleIapLedgerUnavailableError',
  revokeAppleIapTransaction: revokeTxMock,
  updateAppleIapTransactionByTransactionId: updateTxMock,
}))

import { verifyAndPersist } from './iapRoutes.mjs'

const PRODUCT_ID = 'com.aydenz.youmilensipad.studentbasic30d'
const REVOKED_AT = '2026-06-15T10:30:00.000Z'

function makeDb({ existingGrant, entitlementUpdates }) {
  return {
    from(table) {
      if (table === 'billing_products') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: {
                      product_id: PRODUCT_ID,
                      plan_type: 'student_pass',
                      kind: 'consumable',
                      entitlement_days: 30,
                      is_purchasable: true,
                      sales_end_at: null,
                    },
                    error: null,
                  }),
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
                  maybeSingle: async () => ({ data: existingGrant, error: null }),
                }
              },
            }
          },
          update(row) {
            return {
              eq(column, value) {
                entitlementUpdates.push({ row, filter: [column, value] })
                return { error: null }
              },
            }
          },
        }
      }

      throw new Error(`Unexpected table ${table}`)
    },
  }
}

describe('IAP verify replay reconciliation', () => {
  it('revokes an existing entitlement when Apple verifies the transaction as revoked', async () => {
    const entitlementUpdates = []
    const existingGrant = {
      product_id: PRODUCT_ID,
      plan_type: 'student_pass',
      starts_at: '2026-06-10T12:00:00.000Z',
      expires_at: '2026-07-10T12:00:00.000Z',
      status: 'active',
      revoked_at: null,
      source_transaction_id: 'tx-refunded',
    }
    const verified = {
      productId: PRODUCT_ID,
      transactionId: 'tx-refunded',
      originalTransactionId: 'tx-refunded',
      environment: 'Sandbox',
      purchaseDateMs: Date.parse('2026-06-10T12:00:00.000Z'),
      purchaseDate: '2026-06-10T12:00:00.000Z',
      appleExpiresDate: null,
      revoked: true,
      revokedAt: REVOKED_AT,
      rawTransaction: { transactionId: 'tx-refunded', revocationDate: Date.parse(REVOKED_AT) },
    }

    verifyAppleTransactionMock.mockResolvedValueOnce(verified)
    findBindingMock.mockResolvedValueOnce({ userId: 'user-1', ownerState: 'active' })
    updateTxMock.mockResolvedValueOnce({ error: null })
    revokeTxMock.mockResolvedValueOnce({ error: null })
    insertTxMock.mockResolvedValueOnce({ error: null })

    const result = await verifyAndPersist(
      makeDb({ existingGrant, entitlementUpdates }),
      { userId: 'user-1', email: 'student@example.com' },
      { signedTransactionInfo: 'signed-refunded-transaction' },
    )

    expect(result).toEqual({ granted: false, code: 'revoked' })
    expect(entitlementUpdates).toEqual([
      {
        row: { status: 'revoked', revoked_at: REVOKED_AT },
        filter: ['source_transaction_id', 'tx-refunded'],
      },
    ])
    expect(updateTxMock).toHaveBeenCalledWith(
      expect.anything(),
      'tx-refunded',
      expect.objectContaining({
        status: 'revoked',
        revoked_at: REVOKED_AT,
        raw_transaction: verified.rawTransaction,
      }),
    )
    expect(revokeTxMock).not.toHaveBeenCalled()
    expect(insertTxMock).not.toHaveBeenCalled()
  })
})
