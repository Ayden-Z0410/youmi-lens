import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.SUPABASE_URL = 'https://stub.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-stub'
  process.env.SUPABASE_ANON_KEY = 'anon-stub'
})

const {
  adminDb,
  entitlementUpdates,
  findBindingMock,
  getUserMock,
  insertTransactionMock,
  recordInserts,
  revokeTransactionMock,
  updateTransactionMock,
  verifyAppleTransactionMock,
} = vi.hoisted(() => {
  const product = {
    product_id: 'com.aydenz.youmilensipad.studentpass30d',
    plan_type: 'student_pass',
    kind: 'non_renewing',
    entitlement_days: 30,
    is_purchasable: true,
    sales_end_at: '2026-07-19T00:00:00Z',
  }
  const entitlementUpdates = []
  const recordInserts = []
  const chain = (table) => {
    const state = { updates: null, filters: [] }
    const builder = {
      select() {
        return builder
      },
      eq(column, value) {
        state.filters.push({ column, value })
        if (state.updates) {
          if (table === 'user_entitlements') {
            entitlementUpdates.push({ updates: state.updates, filters: [...state.filters] })
          }
          return { error: null }
        }
        return builder
      },
      maybeSingle() {
        if (table === 'billing_products') return { data: product, error: null }
        return { data: null, error: null }
      },
      update(updates) {
        state.updates = updates
        return builder
      },
      insert(row) {
        recordInserts.push({ table, row })
        return { error: null }
      },
      upsert(row) {
        recordInserts.push({ table, row })
        return { error: null }
      },
    }
    return builder
  }
  return {
    adminDb: { from: (table) => chain(table) },
    entitlementUpdates,
    findBindingMock: vi.fn(),
    getUserMock: vi.fn(),
    insertTransactionMock: vi.fn(),
    recordInserts,
    revokeTransactionMock: vi.fn(),
    updateTransactionMock: vi.fn(),
    verifyAppleTransactionMock: vi.fn(),
  }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url, key) => {
    if (key === 'anon-stub') {
      return { auth: { getUser: getUserMock } }
    }
    return adminDb
  },
}))

vi.mock('./iapApple.mjs', () => ({
  verifyAppleNotification: vi.fn(),
  verifyAppleTransaction: verifyAppleTransactionMock,
}))

vi.mock('./iapLedger.mjs', () => ({
  findAppleIapTransactionBinding: findBindingMock,
  insertAppleIapTransaction: insertTransactionMock,
  isAppleIapLedgerUnavailableError: () => false,
  revokeAppleIapTransaction: revokeTransactionMock,
  updateAppleIapTransactionByTransactionId: updateTransactionMock,
}))

vi.mock('./betaGate.mjs', () => ({
  BETA_ERROR_CODES: { AUTH_REQUIRED: 'auth_required' },
  getOrCreateUserQuota: vi.fn(),
}))

vi.mock('./betaUsageStatus.mjs', () => ({
  buildQuotaStatus: vi.fn(async () => ({ planType: 'public_trial', entitlement: null })),
}))

import { handleIapVerify } from './iapRoutes.mjs'

const revokedTransaction = {
  productId: 'com.aydenz.youmilensipad.studentpass30d',
  transactionId: 'tx-revoked',
  originalTransactionId: 'orig-revoked',
  environment: 'Sandbox',
  purchaseDateMs: Date.parse('2026-06-10T12:00:00Z'),
  purchaseDate: '2026-06-10T12:00:00.000Z',
  appleExpiresDate: null,
  revokedAt: '2026-06-15T00:00:00.000Z',
  revoked: true,
  rawTransaction: { transactionId: 'tx-revoked', revocationDate: Date.parse('2026-06-15T00:00:00Z') },
}

function fakeReq(body = {}) {
  return {
    headers: { authorization: 'Bearer session-token' },
    body: { platform: 'ios', signedTransactionInfo: 'signed-tx', ...body },
  }
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }
}

describe('handleIapVerify', () => {
  beforeEach(() => {
    entitlementUpdates.length = 0
    recordInserts.length = 0
    getUserMock.mockReset()
    verifyAppleTransactionMock.mockReset()
    findBindingMock.mockReset()
    insertTransactionMock.mockReset()
    updateTransactionMock.mockReset()
    revokeTransactionMock.mockReset()

    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'student@example.com' } }, error: null })
    verifyAppleTransactionMock.mockResolvedValue(revokedTransaction)
    findBindingMock.mockResolvedValue({ userId: 'user-1', ownerState: 'active' })
    updateTransactionMock.mockResolvedValue({ error: null })
    insertTransactionMock.mockResolvedValue({ error: null })
    revokeTransactionMock.mockResolvedValue({ error: null })
  })

  it('revokes an existing entitlement when Apple re-verifies a refunded transaction', async () => {
    const res = fakeRes()

    await handleIapVerify(fakeReq(), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, granted: false, reason: 'revoked' })
    expect(updateTransactionMock).toHaveBeenCalledWith(
      adminDb,
      'tx-revoked',
      expect.objectContaining({
        status: 'revoked',
        revoked_at: '2026-06-15T00:00:00.000Z',
      }),
    )
    expect(entitlementUpdates).toEqual([
      {
        updates: { status: 'revoked', revoked_at: '2026-06-15T00:00:00.000Z' },
        filters: [{ column: 'source_transaction_id', value: 'tx-revoked' }],
      },
    ])
    expect(revokeTransactionMock).toHaveBeenCalledWith(adminDb, 'tx-revoked', '2026-06-15T00:00:00.000Z')
  })
})
