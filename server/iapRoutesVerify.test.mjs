import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyAppleTransaction: vi.fn(),
  updateAppleIapTransactionByTransactionId: vi.fn(),
  revokeAppleIapTransaction: vi.fn(),
  decideGrantWithBinding: vi.fn(),
  loadBillingProduct: vi.fn(),
  findTransactionBinding: vi.fn(),
  getEntitlementBySourceTransactionId: vi.fn(),
  getRestackableStudentPassEntitlements: vi.fn(),
  loadBillingProducts: vi.fn(),
  computeRestackedConsumableEntitlementUpdates: vi.fn(),
  recordBillingEvent: vi.fn(),
}))

vi.mock('./iapApple.mjs', () => ({
  verifyAppleTransaction: mocks.verifyAppleTransaction,
  verifyAppleNotification: vi.fn(),
}))

vi.mock('./iapLedger.mjs', () => ({
  isAppleIapLedgerUnavailableError: vi.fn(() => false),
  insertAppleIapTransaction: vi.fn(),
  updateAppleIapTransactionByTransactionId: mocks.updateAppleIapTransactionByTransactionId,
  revokeAppleIapTransaction: mocks.revokeAppleIapTransaction,
}))

vi.mock('./iapEntitlements.mjs', () => ({
  decideGrantWithBinding: mocks.decideGrantWithBinding,
  loadBillingProduct: mocks.loadBillingProduct,
  findTransactionBinding: mocks.findTransactionBinding,
  findTransactionOwner: vi.fn(),
  getActiveEntitlement: vi.fn(),
  getEntitlementBySourceTransactionId: mocks.getEntitlementBySourceTransactionId,
  getLatestStackableEntitlementExpiry: vi.fn(),
  getLatestStudentPassEntitlement: vi.fn(),
  getLatestRevocationEventType: vi.fn(),
  getRestackableStudentPassEntitlements: mocks.getRestackableStudentPassEntitlements,
  loadBillingProducts: mocks.loadBillingProducts,
  computeRestackedConsumableEntitlementUpdates: mocks.computeRestackedConsumableEntitlementUpdates,
  deriveInactiveEntitlementStatus: vi.fn(),
  safeEntitlementSnapshot: vi.fn(),
  recordBillingEvent: mocks.recordBillingEvent,
  reserveNotification: vi.fn(),
  markNotificationProcessed: vi.fn(),
  markNotificationFailed: vi.fn(),
}))

const { verifyAndPersist } = await import('./iapRoutes.mjs')

describe('IAP verify persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updateAppleIapTransactionByTransactionId.mockResolvedValue({ error: null })
    mocks.revokeAppleIapTransaction.mockResolvedValue({ error: null })
    mocks.getRestackableStudentPassEntitlements.mockResolvedValue([])
    mocks.loadBillingProducts.mockResolvedValue([])
    mocks.computeRestackedConsumableEntitlementUpdates.mockReturnValue([])
  })

  it('revokes an existing active grant when Apple replay verification reports revocation', async () => {
    const revokedAt = '2026-06-14T11:00:00.000Z'
    const verified = {
      productId: 'com.aydenz.youmilensipad.studentbasic30d',
      transactionId: 'tx-1',
      originalTransactionId: 'tx-1',
      environment: 'Sandbox',
      purchaseDate: '2026-06-10T12:00:00.000Z',
      appleExpiresDate: null,
      rawTransaction: { transactionId: 'tx-1' },
      revoked: true,
      revokedAt,
    }
    const existingGrant = {
      user_id: 'user-1',
      product_id: verified.productId,
      plan_type: 'student_pass',
      starts_at: '2026-06-10T12:00:00.000Z',
      expires_at: '2026-07-10T12:00:00.000Z',
      status: 'active',
      revoked_at: null,
      source_transaction_id: verified.transactionId,
    }
    const entitlementUpdates = []
    const db = {
      from(table) {
        return {
          update(row) {
            entitlementUpdates.push({ table, row })
            return {
              eq() {
                return { error: null }
              },
            }
          },
        }
      },
    }

    mocks.verifyAppleTransaction.mockResolvedValue(verified)
    mocks.loadBillingProduct.mockResolvedValue({
      product_id: verified.productId,
      plan_type: 'student_pass',
      kind: 'consumable',
      entitlement_days: 30,
    })
    mocks.findTransactionBinding.mockResolvedValue({ userId: 'user-1', ownerState: 'active' })
    mocks.getEntitlementBySourceTransactionId.mockResolvedValue(existingGrant)

    await expect(
      verifyAndPersist(db, { userId: 'user-1', email: 'student@example.com' }, {
        signedTransactionInfo: 'signed',
      }),
    ).resolves.toEqual({ granted: false, code: 'revoked' })

    expect(mocks.updateAppleIapTransactionByTransactionId).toHaveBeenCalledWith(
      db,
      verified.transactionId,
      expect.objectContaining({ status: 'revoked', revoked_at: revokedAt }),
    )
    expect(entitlementUpdates).toContainEqual({
      table: 'user_entitlements',
      row: { status: 'revoked', revoked_at: revokedAt },
    })
    expect(mocks.revokeAppleIapTransaction).toHaveBeenCalledWith(db, verified.transactionId, revokedAt)
    expect(mocks.recordBillingEvent).toHaveBeenCalledWith(
      db,
      'user-1',
      expect.objectContaining({
        event_type: 'grant',
        detail: { granted: false, reason: 'revoked' },
      }),
    )
  })
})
