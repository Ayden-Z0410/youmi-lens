import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyAppleTransaction: vi.fn(),
  verifyAppleNotification: vi.fn(),
  insertAppleIapTransaction: vi.fn(),
  updateAppleIapTransactionByTransactionId: vi.fn(),
  revokeAppleIapTransaction: vi.fn(),
  isAppleIapLedgerUnavailableError: vi.fn(),
  decideGrantWithBinding: vi.fn(),
  loadBillingProduct: vi.fn(),
  findTransactionBinding: vi.fn(),
  findTransactionOwner: vi.fn(),
  getActiveEntitlement: vi.fn(),
  getEntitlementBySourceTransactionId: vi.fn(),
  getLatestStackableEntitlementExpiry: vi.fn(),
  getLatestStudentPassEntitlement: vi.fn(),
  getLatestRevocationEventType: vi.fn(),
  deriveInactiveEntitlementStatus: vi.fn(),
  safeEntitlementSnapshot: vi.fn(),
  recordBillingEvent: vi.fn(),
  reserveNotification: vi.fn(),
  markNotificationProcessed: vi.fn(),
  markNotificationFailed: vi.fn(),
}))

vi.mock('./iapApple.mjs', () => ({
  verifyAppleTransaction: mocks.verifyAppleTransaction,
  verifyAppleNotification: mocks.verifyAppleNotification,
}))

vi.mock('./iapLedger.mjs', () => ({
  isAppleIapLedgerUnavailableError: mocks.isAppleIapLedgerUnavailableError,
  insertAppleIapTransaction: mocks.insertAppleIapTransaction,
  updateAppleIapTransactionByTransactionId: mocks.updateAppleIapTransactionByTransactionId,
  revokeAppleIapTransaction: mocks.revokeAppleIapTransaction,
}))

vi.mock('./iapEntitlements.mjs', () => ({
  decideGrantWithBinding: mocks.decideGrantWithBinding,
  loadBillingProduct: mocks.loadBillingProduct,
  findTransactionBinding: mocks.findTransactionBinding,
  findTransactionOwner: mocks.findTransactionOwner,
  getActiveEntitlement: mocks.getActiveEntitlement,
  getEntitlementBySourceTransactionId: mocks.getEntitlementBySourceTransactionId,
  getLatestStackableEntitlementExpiry: mocks.getLatestStackableEntitlementExpiry,
  getLatestStudentPassEntitlement: mocks.getLatestStudentPassEntitlement,
  getLatestRevocationEventType: mocks.getLatestRevocationEventType,
  deriveInactiveEntitlementStatus: mocks.deriveInactiveEntitlementStatus,
  safeEntitlementSnapshot: mocks.safeEntitlementSnapshot,
  recordBillingEvent: mocks.recordBillingEvent,
  reserveNotification: mocks.reserveNotification,
  markNotificationProcessed: mocks.markNotificationProcessed,
  markNotificationFailed: mocks.markNotificationFailed,
}))

import { verifyAndPersist } from './iapRoutes.mjs'

const PRODUCT_ID = 'com.aydenz.youmilensipad.studentbasic30d'
const REVOKED_AT = '2026-06-15T10:00:00.000Z'

function createDb() {
  const eq = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn(() => ({ eq }))
  const from = vi.fn((table) => {
    if (table === 'user_entitlements') return { update }
    throw new Error(`unexpected table ${table}`)
  })
  return { from, update, eq }
}

function verified(overrides = {}) {
  return {
    productId: PRODUCT_ID,
    transactionId: 'tx-1',
    originalTransactionId: 'orig-1',
    environment: 'Sandbox',
    purchaseDateMs: Date.parse('2026-06-10T12:00:00Z'),
    purchaseDate: '2026-06-10T12:00:00.000Z',
    appleExpiresDate: null,
    revokedAt: null,
    revoked: false,
    rawTransaction: { transactionId: 'tx-1' },
    ...overrides,
  }
}

describe('verifyAndPersist idempotent replay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadBillingProduct.mockResolvedValue({
      product_id: PRODUCT_ID,
      plan_type: 'student_pass',
      kind: 'consumable',
      entitlement_days: 30,
      sales_end_at: null,
    })
    mocks.findTransactionBinding.mockResolvedValue({ userId: 'user-1', ownerState: 'active' })
    mocks.getEntitlementBySourceTransactionId.mockResolvedValue({
      product_id: PRODUCT_ID,
      plan_type: 'student_pass',
      starts_at: '2026-06-10T12:00:00.000Z',
      expires_at: '2026-07-10T12:00:00.000Z',
      status: 'active',
      revoked_at: null,
      source_transaction_id: 'tx-1',
    })
    mocks.updateAppleIapTransactionByTransactionId.mockResolvedValue({ error: null })
    mocks.revokeAppleIapTransaction.mockResolvedValue({ error: null })
  })

  it('revokes an existing grant when the replayed Apple transaction is now revoked', async () => {
    const db = createDb()
    mocks.verifyAppleTransaction.mockResolvedValue(
      verified({
        revoked: true,
        revokedAt: REVOKED_AT,
        rawTransaction: { transactionId: 'tx-1', revocationDate: Date.parse(REVOKED_AT) },
      }),
    )

    const result = await verifyAndPersist(
      db,
      { userId: 'user-1', email: 'student@example.com' },
      { signedTransactionInfo: 'signed-jws' },
    )

    expect(result).toEqual({ granted: false, code: 'revoked' })
    expect(db.update).toHaveBeenCalledWith({ status: 'revoked', revoked_at: REVOKED_AT })
    expect(db.eq).toHaveBeenCalledWith('source_transaction_id', 'tx-1')
    expect(mocks.revokeAppleIapTransaction).toHaveBeenCalledWith(db, 'tx-1', REVOKED_AT)
    expect(mocks.updateAppleIapTransactionByTransactionId).toHaveBeenCalledWith(
      db,
      'tx-1',
      expect.objectContaining({
        status: 'revoked',
        revoked_at: REVOKED_AT,
        raw_transaction: { transactionId: 'tx-1', revocationDate: Date.parse(REVOKED_AT) },
      }),
    )
    expect(mocks.recordBillingEvent).toHaveBeenCalledWith(
      db,
      'user-1',
      expect.objectContaining({
        event_type: 'revoke',
        product_id: PRODUCT_ID,
        transaction_id: 'tx-1',
        environment: 'Sandbox',
        detail: { source: 'verify_replay' },
      }),
    )
    expect(mocks.decideGrantWithBinding).not.toHaveBeenCalled()
  })
})
