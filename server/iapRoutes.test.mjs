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
const TX_ID = 'tx-revoked'
const REVOKED_AT = '2026-06-18T12:00:00.000Z'

const missingLegacyLedger = {
  code: 'PGRST205',
  message: "Could not find the table 'public.app_store_subscriptions' in the schema cache",
  details: 'schema cache could not find the table',
}

function ok(data = null) {
  return { data, error: null }
}

function fakeIapDb() {
  const calls = []
  const db = {
    calls,
    rpc(name, args) {
      calls.push({ method: 'rpc', name, args })
      return Promise.resolve(ok())
    },
    from(table) {
      const state = {
        table,
        columns: null,
        filters: [],
        updates: null,
      }
      const builder = {
        select(columns) {
          state.columns = columns
          return builder
        },
        eq(column, value) {
          state.filters.push({ column, value })
          if (state.updates) {
            calls.push({ table, method: 'update', filters: [...state.filters], updates: state.updates })
            return Promise.resolve(ok())
          }
          return builder
        },
        maybeSingle() {
          calls.push({ table, method: 'maybeSingle', columns: state.columns, filters: [...state.filters] })
          if (table === 'billing_products') {
            return Promise.resolve(ok({
              product_id: PRODUCT_ID,
              plan_type: 'student_pass',
              kind: 'consumable',
              entitlement_days: 30,
              is_purchasable: true,
              sales_end_at: null,
            }))
          }
          if (table === 'apple_iap_transactions') {
            return Promise.resolve(ok({ user_id: 'user-1', owner_state: 'active' }))
          }
          if (table === 'user_entitlements') {
            return Promise.resolve(ok({
              product_id: PRODUCT_ID,
              plan_type: 'student_pass',
              starts_at: '2026-06-01T00:00:00.000Z',
              expires_at: '2026-07-01T00:00:00.000Z',
              status: 'active',
              revoked_at: null,
              source_transaction_id: TX_ID,
            }))
          }
          return Promise.resolve(ok(null))
        },
        limit() {
          calls.push({ table, method: 'limit', columns: state.columns, filters: [...state.filters] })
          if (table === 'apple_iap_transactions') return Promise.resolve(ok([{ transaction_id: TX_ID }]))
          if (table === 'app_store_subscriptions') {
            return Promise.resolve({ data: null, error: missingLegacyLedger })
          }
          return Promise.resolve(ok([]))
        },
        update(updates) {
          state.updates = updates
          return builder
        },
        insert(row) {
          calls.push({ table, method: 'insert', row })
          return Promise.resolve(ok())
        },
      }
      return builder
    },
  }
  return db
}

describe('verifyAndPersist', () => {
  it('revokes an existing grant when Apple replay verification now reports revocation', async () => {
    verifyAppleTransactionMock.mockResolvedValue({
      productId: PRODUCT_ID,
      transactionId: TX_ID,
      originalTransactionId: TX_ID,
      environment: 'Sandbox',
      purchaseDate: '2026-06-01T00:00:00.000Z',
      purchaseDateMs: Date.parse('2026-06-01T00:00:00.000Z'),
      appleExpiresDate: null,
      revokedAt: REVOKED_AT,
      revoked: true,
      rawTransaction: { transactionId: TX_ID, revocationDate: Date.parse(REVOKED_AT) },
    })
    const db = fakeIapDb()

    await expect(
      verifyAndPersist(db, { userId: 'user-1', email: 'student@example.com' }, { signedTransactionInfo: 'jws' }),
    ).resolves.toMatchObject({
      granted: false,
      code: 'revoked',
    })

    expect(db.calls).toContainEqual({
      method: 'rpc',
      name: 'revoke_student_pass_entitlement',
      args: {
        p_source_transaction_id: TX_ID,
        p_revoked_at: REVOKED_AT,
      },
    })
    expect(
      db.calls.filter((call) => call.table === 'apple_iap_transactions' && call.method === 'update'),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          updates: expect.objectContaining({ status: 'revoked', revoked_at: REVOKED_AT }),
        }),
      ]),
    )
    expect(db.calls).toContainEqual({
      table: 'billing_events',
      method: 'insert',
      row: {
        user_id: 'user-1',
        event_type: 'grant',
        product_id: PRODUCT_ID,
        transaction_id: TX_ID,
        environment: 'Sandbox',
        detail: { granted: false, reason: 'revoked' },
      },
    })
  })
})
