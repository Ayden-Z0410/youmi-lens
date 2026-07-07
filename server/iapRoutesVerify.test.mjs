import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  decideGrantWithBindingMock,
  findTransactionBindingMock,
  getEntitlementBySourceTransactionIdMock,
  getLatestStackableEntitlementExpiryMock,
  insertAppleIapTransactionMock,
  loadBillingProductMock,
  recordBillingEventMock,
  revokeAppleIapTransactionMock,
  updateAppleIapTransactionByTransactionIdMock,
  verifyAppleNotificationMock,
  verifyAppleTransactionMock,
} = vi.hoisted(() => ({
  decideGrantWithBindingMock: vi.fn(),
  findTransactionBindingMock: vi.fn(),
  getEntitlementBySourceTransactionIdMock: vi.fn(),
  getLatestStackableEntitlementExpiryMock: vi.fn(),
  insertAppleIapTransactionMock: vi.fn(),
  loadBillingProductMock: vi.fn(),
  recordBillingEventMock: vi.fn(),
  revokeAppleIapTransactionMock: vi.fn(),
  updateAppleIapTransactionByTransactionIdMock: vi.fn(),
  verifyAppleNotificationMock: vi.fn(),
  verifyAppleTransactionMock: vi.fn(),
}))

vi.mock('./iapApple.mjs', () => ({
  verifyAppleNotification: verifyAppleNotificationMock,
  verifyAppleTransaction: verifyAppleTransactionMock,
}))

vi.mock('./iapLedger.mjs', () => ({
  isAppleIapLedgerUnavailableError: (error) => error?.name === 'AppleIapLedgerUnavailableError',
  insertAppleIapTransaction: insertAppleIapTransactionMock,
  revokeAppleIapTransaction: revokeAppleIapTransactionMock,
  updateAppleIapTransactionByTransactionId: updateAppleIapTransactionByTransactionIdMock,
}))

vi.mock('./iapEntitlements.mjs', () => ({
  decideGrantWithBinding: decideGrantWithBindingMock,
  deriveInactiveEntitlementStatus: () => null,
  findTransactionBinding: findTransactionBindingMock,
  findTransactionOwner: async () => null,
  getActiveEntitlement: async () => null,
  getEntitlementBySourceTransactionId: getEntitlementBySourceTransactionIdMock,
  getLatestRevocationEventType: async () => null,
  getLatestStackableEntitlementExpiry: getLatestStackableEntitlementExpiryMock,
  getLatestStudentPassEntitlement: async () => null,
  loadBillingProduct: loadBillingProductMock,
  markNotificationFailed: async () => undefined,
  markNotificationProcessed: async () => undefined,
  recordBillingEvent: recordBillingEventMock,
  reserveNotification: async () => ({ reserved: true }),
  safeEntitlementSnapshot: () => null,
}))

vi.mock('./betaGate.mjs', () => ({
  BETA_ERROR_CODES: { AUTH_REQUIRED: 'auth_required' },
  getOrCreateUserQuota: async () => null,
}))

vi.mock('./betaUsageStatus.mjs', () => ({
  buildQuotaStatus: async () => null,
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => null,
}))

import { verifyAndPersist } from './iapRoutes.mjs'

const PRODUCT_ID = 'com.aydenz.youmilensipad.studentbasic30d'
const REVOKED_AT = '2026-06-20T12:00:00.000Z'

function verified(overrides = {}) {
  return {
    productId: PRODUCT_ID,
    transactionId: 'tx-1',
    originalTransactionId: 'tx-1',
    environment: 'Sandbox',
    purchaseDate: '2026-06-10T12:00:00.000Z',
    appleExpiresDate: null,
    rawTransaction: { transactionId: 'tx-1' },
    revoked: false,
    revokedAt: null,
    ...overrides,
  }
}

function activeGrant(overrides = {}) {
  return {
    product_id: PRODUCT_ID,
    plan_type: 'student_pass',
    source_transaction_id: 'tx-1',
    starts_at: '2026-06-10T12:00:00.000Z',
    expires_at: '2026-07-10T12:00:00.000Z',
    status: 'active',
    revoked_at: null,
    ...overrides,
  }
}

describe('verifyAndPersist existing entitlement replay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyAppleTransactionMock.mockResolvedValue(verified())
    loadBillingProductMock.mockResolvedValue({
      product_id: PRODUCT_ID,
      plan_type: 'student_pass',
      kind: 'consumable',
      entitlement_days: 30,
    })
    findTransactionBindingMock.mockResolvedValue({ userId: 'user-1', ownerState: 'active' })
    getEntitlementBySourceTransactionIdMock.mockResolvedValue(activeGrant())
    updateAppleIapTransactionByTransactionIdMock.mockResolvedValue({ error: null })
    revokeAppleIapTransactionMock.mockResolvedValue({ error: null })
    recordBillingEventMock.mockResolvedValue(undefined)
  })

  it('revokes local access when Apple returns a revoked same-user replay', async () => {
    verifyAppleTransactionMock.mockResolvedValue(verified({
      revoked: true,
      revokedAt: REVOKED_AT,
      rawTransaction: { transactionId: 'tx-1', revocationDate: Date.parse(REVOKED_AT) },
    }))

    const db = {
      from(table) {
        expect(table).toBe('user_entitlements')
        return {
          update(updates) {
            expect(updates).toEqual({ status: 'revoked', revoked_at: REVOKED_AT })
            return {
              eq(column, value) {
                expect(column).toBe('source_transaction_id')
                expect(value).toBe('tx-1')
                return Promise.resolve({ error: null })
              },
            }
          },
        }
      },
    }

    await expect(
      verifyAndPersist(db, { userId: 'user-1', email: 'student@example.com' }, { signedTransactionInfo: 'jws' }),
    ).resolves.toEqual({ granted: false, code: 'revoked' })

    expect(revokeAppleIapTransactionMock).toHaveBeenCalledWith(db, 'tx-1', REVOKED_AT)
    expect(updateAppleIapTransactionByTransactionIdMock).toHaveBeenCalledWith(
      db,
      'tx-1',
      expect.objectContaining({
        status: 'revoked',
        revoked_at: REVOKED_AT,
        raw_transaction: { transactionId: 'tx-1', revocationDate: Date.parse(REVOKED_AT) },
      }),
    )
    expect(recordBillingEventMock).toHaveBeenCalledWith(
      db,
      'user-1',
      expect.objectContaining({
        event_type: 'revoke',
        transaction_id: 'tx-1',
        detail: { source: 'verify_replay' },
      }),
    )
    expect(decideGrantWithBindingMock).not.toHaveBeenCalled()
  })
})
