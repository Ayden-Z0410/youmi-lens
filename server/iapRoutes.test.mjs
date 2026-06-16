import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    findAppleIapTransactionBinding: vi.fn(),
    insertAppleIapTransaction: vi.fn(),
    isAppleIapLedgerUnavailableError: vi.fn(),
    revokeAppleIapTransaction: vi.fn(),
    updateAppleIapTransactionByTransactionId: vi.fn(),
    verifyAppleNotification: vi.fn(),
    verifyAppleTransaction: vi.fn(),
  },
}))

vi.mock('./iapApple.mjs', () => ({
  verifyAppleNotification: mocks.verifyAppleNotification,
  verifyAppleTransaction: mocks.verifyAppleTransaction,
}))

vi.mock('./iapLedger.mjs', () => ({
  findAppleIapTransactionBinding: mocks.findAppleIapTransactionBinding,
  insertAppleIapTransaction: mocks.insertAppleIapTransaction,
  isAppleIapLedgerUnavailableError: mocks.isAppleIapLedgerUnavailableError,
  revokeAppleIapTransaction: mocks.revokeAppleIapTransaction,
  updateAppleIapTransactionByTransactionId: mocks.updateAppleIapTransactionByTransactionId,
}))

import { verifyAndPersist } from './iapRoutes.mjs'

const PRODUCT_ID = 'com.aydenz.youmilensipad.studentbasic30d'
const PURCHASE_DATE = '2026-06-10T12:00:00.000Z'
const EXPIRES_AT = '2026-07-10T12:00:00.000Z'

function verified(overrides = {}) {
  return {
    productId: PRODUCT_ID,
    transactionId: 'tx-1',
    originalTransactionId: 'orig-1',
    environment: 'Sandbox',
    purchaseDate: PURCHASE_DATE,
    purchaseDateMs: Date.parse(PURCHASE_DATE),
    appleExpiresDate: '2099-01-01T00:00:00.000Z',
    revoked: false,
    revokedAt: null,
    rawTransaction: 'signed-jws',
    ...overrides,
  }
}

function product() {
  return {
    product_id: PRODUCT_ID,
    plan_type: 'student_pass',
    kind: 'consumable',
    entitlement_days: 30,
    is_purchasable: true,
    sales_end_at: '2026-07-19T00:00:00.000Z',
  }
}

function activeEntitlement() {
  return {
    product_id: PRODUCT_ID,
    plan_type: 'student_pass',
    starts_at: PURCHASE_DATE,
    expires_at: EXPIRES_AT,
    status: 'active',
    revoked_at: null,
    source_transaction_id: 'tx-1',
  }
}

function fakeDb({ calls = [], productRow = product(), entitlementRow = activeEntitlement() } = {}) {
  return {
    from(table) {
      const state = { filters: [], updates: null, insertRow: null }
      const builder = {
        select() {
          return builder
        },
        eq(column, value) {
          state.filters.push({ column, value })
          if (state.updates) {
            calls.push({ table, method: 'update', updates: state.updates, filters: [...state.filters] })
            return Promise.resolve({ data: null, error: null })
          }
          return builder
        },
        maybeSingle() {
          calls.push({ table, method: 'maybeSingle', filters: [...state.filters] })
          if (table === 'billing_products') return Promise.resolve({ data: productRow, error: null })
          if (table === 'user_entitlements') return Promise.resolve({ data: entitlementRow, error: null })
          return Promise.resolve({ data: null, error: null })
        },
        update(updates) {
          state.updates = updates
          return builder
        },
        insert(row) {
          state.insertRow = row
          calls.push({ table, method: 'insert', row })
          return Promise.resolve({ data: null, error: null })
        },
      }
      return builder
    },
  }
}

describe('verifyAndPersist IAP replay handling', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.findAppleIapTransactionBinding.mockResolvedValue({ userId: 'user-1', ownerState: 'active' })
    mocks.insertAppleIapTransaction.mockResolvedValue({ error: null })
    mocks.isAppleIapLedgerUnavailableError.mockReturnValue(false)
    mocks.revokeAppleIapTransaction.mockResolvedValue({ error: null })
    mocks.updateAppleIapTransactionByTransactionId.mockResolvedValue({ error: null })
  })

  it('revokes an existing grant when the replayed Apple transaction is revoked', async () => {
    const revokedAt = '2026-06-20T00:00:00.000Z'
    const transaction = verified({ revoked: true, revokedAt })
    mocks.verifyAppleTransaction.mockResolvedValue(transaction)
    const calls = []

    const result = await verifyAndPersist(
      fakeDb({ calls }),
      { userId: 'user-1', email: 'student@example.edu' },
      { signedTransactionInfo: 'signed-jws' },
    )

    expect(result).toEqual({ granted: false, code: 'revoked' })
    expect(mocks.updateAppleIapTransactionByTransactionId).toHaveBeenCalledWith(
      expect.anything(),
      'tx-1',
      expect.objectContaining({
        status: 'revoked',
        revoked_at: revokedAt,
        raw_transaction: 'signed-jws',
      }),
    )
    expect(calls).toContainEqual({
      table: 'user_entitlements',
      method: 'update',
      updates: { status: 'revoked', revoked_at: revokedAt },
      filters: [{ column: 'source_transaction_id', value: 'tx-1' }],
    })
    expect(mocks.revokeAppleIapTransaction).toHaveBeenCalledWith(expect.anything(), 'tx-1', revokedAt)
  })
})
