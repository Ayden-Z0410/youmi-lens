import { describe, expect, it, vi } from 'vitest'

const { verifyAppleTransactionMock } = vi.hoisted(() => ({
  verifyAppleTransactionMock: vi.fn(),
}))

vi.mock('./iapApple.mjs', () => ({
  verifyAppleTransaction: verifyAppleTransactionMock,
  verifyAppleNotification: vi.fn(),
}))

import { verifyAndPersist } from './iapRoutes.mjs'

const PRODUCT_ID = 'com.aydenz.youmilensipad.studentbasic30d'
const NEW_LEDGER = 'apple_iap_transactions'
const OLD_LEDGER = 'app_store_subscriptions'

const missingOldLedger = {
  code: '42P01',
  message: 'relation "public.app_store_subscriptions" does not exist',
}

function ok(data = null) {
  return { data, error: null }
}

function fakeDb(calls) {
  const product = {
    product_id: PRODUCT_ID,
    plan_type: 'student_pass',
    kind: 'consumable',
    entitlement_days: 30,
    is_purchasable: true,
    sales_end_at: null,
  }
  const activeEntitlement = {
    product_id: PRODUCT_ID,
    plan_type: 'student_pass',
    starts_at: '2026-06-10T12:00:00.000Z',
    expires_at: '2099-01-01T00:00:00.000Z',
    status: 'active',
    revoked_at: null,
    source_transaction_id: 'tx-refunded',
  }

  return {
    from(table) {
      const state = { table, columns: null, updates: null, filters: [] }
      const builder = {
        select(columns) {
          state.columns = columns
          return builder
        },
        update(updates) {
          state.updates = updates
          return builder
        },
        insert(row) {
          calls.push({ table, method: 'insert', row })
          return Promise.resolve(ok())
        },
        eq(column, value) {
          state.filters.push({ column, value })
          if (state.updates) {
            calls.push({ table, method: 'update', updates: state.updates, filters: [...state.filters] })
            return Promise.resolve(ok())
          }
          return builder
        },
        limit() {
          calls.push({ table, method: 'probe', columns: state.columns })
          if (table === NEW_LEDGER) return Promise.resolve(ok([{ transaction_id: 'probe' }]))
          if (table === OLD_LEDGER) return Promise.resolve({ data: null, error: missingOldLedger })
          return Promise.resolve(ok([]))
        },
        maybeSingle() {
          calls.push({ table, method: 'maybeSingle', columns: state.columns, filters: [...state.filters] })
          if (table === 'billing_products') return Promise.resolve(ok(product))
          if (table === NEW_LEDGER) return Promise.resolve(ok({ user_id: 'user-1', owner_state: 'active' }))
          if (table === 'user_entitlements') return Promise.resolve(ok(activeEntitlement))
          return Promise.resolve(ok(null))
        },
      }
      return builder
    },
  }
}

describe('verifyAndPersist idempotent replays', () => {
  it('revokes an existing grant when the replayed Apple transaction is refunded', async () => {
    const revokedAt = '2026-07-05T10:00:00.000Z'
    verifyAppleTransactionMock.mockResolvedValueOnce({
      productId: PRODUCT_ID,
      transactionId: 'tx-refunded',
      originalTransactionId: 'tx-refunded',
      environment: 'Sandbox',
      purchaseDate: '2026-06-10T12:00:00.000Z',
      purchaseDateMs: Date.parse('2026-06-10T12:00:00.000Z'),
      appleExpiresDate: '2099-01-01T00:00:00.000Z',
      revoked: true,
      revokedAt,
      rawTransaction: { transactionId: 'tx-refunded' },
    })

    const calls = []
    const result = await verifyAndPersist(
      fakeDb(calls),
      { userId: 'user-1', email: 'student@example.com' },
      { signedTransactionInfo: 'jws' },
    )

    expect(result).toEqual({ granted: false, code: 'revoked' })

    const entitlementRevokes = calls.filter((call) => call.table === 'user_entitlements' && call.method === 'update')
    expect(entitlementRevokes).toEqual([
      {
        table: 'user_entitlements',
        method: 'update',
        updates: { status: 'revoked', revoked_at: revokedAt },
        filters: [{ column: 'source_transaction_id', value: 'tx-refunded' }],
      },
    ])

    const ledgerUpdates = calls.filter((call) => call.table === NEW_LEDGER && call.method === 'update')
    expect(ledgerUpdates.length).toBeGreaterThanOrEqual(1)
    expect(ledgerUpdates.every((call) => call.updates.status === 'revoked')).toBe(true)
    expect(ledgerUpdates.every((call) => call.updates.revoked_at === revokedAt)).toBe(true)
  })
})
