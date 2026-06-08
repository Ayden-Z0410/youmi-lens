import { beforeEach, describe, expect, it } from 'vitest'
import {
  AppleIapLegacyLedgerWriteError,
  AppleIapLedgerUnavailableError,
  checkAppleIapLedgerAccountDeletionAllowed,
  insertAppleIapTransaction,
  isMissingAppleIapLedgerTableError,
  prepareAppleIapLedgerForAccountDeletion,
  resetAppleIapLedgerTableCache,
  runAppleIapLedgerQuery,
  updateAppleIapTransactionByTransactionId,
} from './iapLedger.mjs'

const NEW = 'apple_iap_transactions'
const OLD = 'app_store_subscriptions'

const missingNew = {
  code: 'PGRST205',
  message: "Could not find the table 'public.apple_iap_transactions' in the schema cache",
  details: 'schema cache could not find the table',
}
const missingOld = {
  code: '42P01',
  message: 'relation "public.app_store_subscriptions" does not exist',
}

const nonFallbackErrors = {
  permission: { code: '42501', message: 'permission denied for table apple_iap_transactions' },
  rls: { code: '42501', message: 'new row violates row-level security policy' },
  missingColumn: { code: '42703', message: 'column owner_state does not exist' },
  constraint: { code: '23514', message: 'violates check constraint' },
  duplicateKey: { code: '23505', message: 'duplicate key value violates unique constraint' },
  malformedQuery: { code: 'PGRST100', message: 'failed to parse filter' },
  network: { message: 'fetch failed' },
  timeout: { code: '57014', message: 'canceling statement due to statement timeout' },
}

function ok(data = []) {
  return { data, error: null }
}

function missing(error) {
  return { data: null, error }
}

function fakeDb(config, calls = []) {
  return {
    from(table) {
      const tableConfig = config[table] ?? {}
      const state = { table, selectColumns: null, selectOptions: null, updates: null }
      const builder = {
        select(columns, options) {
          state.selectColumns = columns
          state.selectOptions = options
          return builder
        },
        limit() {
          calls.push({ table, method: 'select', columns: state.selectColumns, options: state.selectOptions })
          if (state.selectColumns === 'transaction_id' && !state.selectOptions) {
            return Promise.resolve(tableConfig.probe ?? missing(table === NEW ? missingNew : missingOld))
          }
          return Promise.resolve(tableConfig.select ?? ok())
        },
        maybeSingle() {
          calls.push({ table, method: 'maybeSingle', columns: state.selectColumns })
          return Promise.resolve(tableConfig.maybeSingle ?? ok(null))
        },
        eq(column, value) {
          state.eq = { column, value }
          if (state.selectOptions?.head) {
            calls.push({ table, method: 'count', column, value })
            return Promise.resolve({
              data: null,
              error: tableConfig.countError ?? null,
              count: tableConfig.count ?? 0,
            })
          }
          if (state.updates) {
            calls.push({ table, method: 'update', column, value, updates: state.updates })
            return Promise.resolve(tableConfig.update ?? ok(null))
          }
          return builder
        },
        insert(row) {
          calls.push({ table, method: 'insert', row })
          return Promise.resolve(tableConfig.insert ?? ok(null))
        },
        update(updates) {
          state.updates = updates
          return builder
        },
      }
      return builder
    },
  }
}

function tables({ newExists = false, oldExists = false, newProbe, oldProbe } = {}) {
  return {
    [NEW]: { probe: newProbe ?? (newExists ? ok([{ transaction_id: 'tx-new' }]) : missing(missingNew)) },
    [OLD]: { probe: oldProbe ?? (oldExists ? ok([{ transaction_id: 'tx-old' }]) : missing(missingOld)) },
  }
}

function selectOne(db) {
  return runAppleIapLedgerQuery(db, (table) => db.from(table).select('*').limit(1))
}

describe('Apple IAP ledger transition compatibility', () => {
  beforeEach(() => {
    resetAppleIapLedgerTableCache()
  })

  it('uses the legacy table in limited compatibility mode when only the pre-migration table exists', async () => {
    const calls = []
    const db = fakeDb({
      ...tables({ oldExists: true }),
      [OLD]: { ...tables({ oldExists: true })[OLD], select: ok([{ transaction_id: 'tx-old' }]) },
    }, calls)

    await expect(selectOne(db)).resolves.toMatchObject({
      table: OLD,
      mode: 'legacy',
      data: [{ transaction_id: 'tx-old' }],
      error: null,
    })
    expect(calls.map((call) => call.table)).toEqual([NEW, OLD, OLD])
  })

  it('uses the new table when only the post-migration table exists', async () => {
    const calls = []
    const db = fakeDb({
      ...tables({ newExists: true }),
      [NEW]: { ...tables({ newExists: true })[NEW], select: ok([{ transaction_id: 'tx-new' }]) },
    }, calls)

    await expect(selectOne(db)).resolves.toMatchObject({
      table: NEW,
      mode: 'new',
      data: [{ transaction_id: 'tx-new' }],
      error: null,
    })
    expect(calls.map((call) => call.table)).toEqual([NEW, OLD, NEW])
  })

  it('fails closed when both tables are present', async () => {
    const db = fakeDb(tables({ newExists: true, oldExists: true }))

    await expect(selectOne(db)).rejects.toMatchObject({
      name: 'AppleIapLedgerUnavailableError',
      reason: 'split_brain_both_ledgers_present',
    })
  })

  it('fails closed when neither table is present', async () => {
    const db = fakeDb(tables())

    await expect(selectOne(db)).rejects.toMatchObject({
      name: 'AppleIapLedgerUnavailableError',
      reason: 'no_iap_ledger_present',
    })
  })

  it('allows legacy fallback only for an exact missing-new-table condition', async () => {
    const db = fakeDb({
      [NEW]: { probe: missing(missingNew) },
      [OLD]: { probe: ok(), select: ok([{ transaction_id: 'tx-old' }]) },
    })

    await expect(selectOne(db)).resolves.toMatchObject({ table: OLD, mode: 'legacy' })
  })

  for (const [name, error] of Object.entries(nonFallbackErrors)) {
    it(`does not fall back on ${name} errors`, async () => {
      const calls = []
      const db = fakeDb({
        [NEW]: { probe: missing(error) },
        [OLD]: { probe: ok(), select: ok([{ transaction_id: 'tx-old' }]) },
      }, calls)

      await expect(selectOne(db)).rejects.toBeInstanceOf(AppleIapLedgerUnavailableError)
      expect(calls.map((call) => call.table)).toEqual([NEW, OLD])
    })
  }

  it('does not use legacy when the new table is missing but the legacy probe has a non-fallback error', async () => {
    const calls = []
    const db = fakeDb({
      [NEW]: { probe: missing(missingNew) },
      [OLD]: { probe: missing(nonFallbackErrors.permission), select: ok([{ transaction_id: 'tx-old' }]) },
    }, calls)

    await expect(selectOne(db)).rejects.toMatchObject({
      reason: 'legacy_probe_failed',
    })
    expect(calls.map((call) => call.table)).toEqual([NEW, OLD])
  })

  it('does not classify missing-column errors as missing-table fallback', () => {
    expect(isMissingAppleIapLedgerTableError(nonFallbackErrors.missingColumn)).toBe(false)
  })

  it('never dual-writes and writes only to the new ledger after migration', async () => {
    const calls = []
    const db = fakeDb({
      ...tables({ newExists: true }),
      [NEW]: { ...tables({ newExists: true })[NEW], insert: ok(null) },
    }, calls)

    await expect(insertAppleIapTransaction(db, { transaction_id: 'tx-new' })).resolves.toMatchObject({
      table: NEW,
      mode: 'new',
      error: null,
    })
    expect(calls.filter((call) => call.method === 'insert').map((call) => call.table)).toEqual([NEW])
  })

  it('blocks new Student Pass transaction writes in legacy mode', async () => {
    const calls = []
    const db = fakeDb(tables({ oldExists: true }), calls)

    await expect(insertAppleIapTransaction(db, { transaction_id: 'tx-new' })).rejects.toBeInstanceOf(
      AppleIapLegacyLedgerWriteError,
    )
    await expect(updateAppleIapTransactionByTransactionId(db, 'tx-new', { status: 'active' })).rejects.toBeInstanceOf(
      AppleIapLegacyLedgerWriteError,
    )
    expect(calls.some((call) => call.method === 'insert' || call.method === 'update')).toBe(false)
  })

  it('detects migration on the next call after a legacy resolution', async () => {
    const oldOnly = fakeDb({
      ...tables({ oldExists: true }),
      [OLD]: { ...tables({ oldExists: true })[OLD], select: ok([{ transaction_id: 'tx-old' }]) },
    })
    await expect(selectOne(oldOnly)).resolves.toMatchObject({ table: OLD, mode: 'legacy' })

    const newOnlyCalls = []
    const newOnly = fakeDb({
      ...tables({ newExists: true }),
      [NEW]: { ...tables({ newExists: true })[NEW], select: ok([{ transaction_id: 'tx-new' }]) },
    }, newOnlyCalls)
    await expect(selectOne(newOnly)).resolves.toMatchObject({ table: NEW, mode: 'new' })
    expect(newOnlyCalls.map((call) => call.table)).toEqual([NEW, OLD, NEW])
  })

  it('split-brain stays fail-closed for writes', async () => {
    const calls = []
    const db = fakeDb(tables({ newExists: true, oldExists: true }), calls)

    await expect(insertAppleIapTransaction(db, { transaction_id: 'tx-new' })).rejects.toMatchObject({
      reason: 'split_brain_both_ledgers_present',
    })
    expect(calls.some((call) => call.method === 'insert')).toBe(false)
  })
})

describe('Apple IAP ledger account deletion transition behavior', () => {
  beforeEach(() => {
    resetAppleIapLedgerTableCache()
  })

  it('preflights new-ledger account deletion without mutating ownership', async () => {
    const calls = []
    const db = fakeDb(tables({ newExists: true }), calls)

    await expect(checkAppleIapLedgerAccountDeletionAllowed(db, 'user-1')).resolves.toMatchObject({
      table: NEW,
      mode: 'new',
      allowed: true,
      reason: 'new_ledger_available',
    })
    expect(calls.some((call) => call.method === 'update')).toBe(false)
  })

  it('allows legacy-mode account deletion when no billing rows exist', async () => {
    const db = fakeDb({
      ...tables({ oldExists: true }),
      [OLD]: { ...tables({ oldExists: true })[OLD], count: 0 },
    })

    await expect(prepareAppleIapLedgerForAccountDeletion(db, 'user-1')).resolves.toMatchObject({
      table: OLD,
      mode: 'legacy',
      allowed: true,
      reason: 'legacy_ledger_no_billing_rows',
    })
  })

  it('safely blocks legacy-mode account deletion when billing rows exist', async () => {
    const db = fakeDb({
      ...tables({ oldExists: true }),
      [OLD]: { ...tables({ oldExists: true })[OLD], count: 2 },
    })

    await expect(prepareAppleIapLedgerForAccountDeletion(db, 'user-1')).resolves.toMatchObject({
      table: OLD,
      mode: 'legacy',
      allowed: false,
      blocked: true,
      reason: 'legacy_ledger_has_billing_rows',
      affectedRows: 2,
    })
  })

  it('marks ownership deleted in new-ledger mode and allows deletion', async () => {
    const calls = []
    const db = fakeDb({
      ...tables({ newExists: true }),
      [NEW]: { ...tables({ newExists: true })[NEW], update: ok(null) },
    }, calls)

    await expect(prepareAppleIapLedgerForAccountDeletion(db, 'user-1', '2026-06-05T00:00:00.000Z')).resolves.toMatchObject({
      table: NEW,
      mode: 'new',
      allowed: true,
      reason: 'new_ledger_marked_account_deleted',
    })
    expect(calls.find((call) => call.method === 'update')).toMatchObject({
      table: NEW,
      column: 'user_id',
      value: 'user-1',
      updates: {
        owner_state: 'account_deleted',
        account_deleted_at: '2026-06-05T00:00:00.000Z',
      },
    })
  })

  it('fails closed for split-brain account deletion', async () => {
    const db = fakeDb(tables({ newExists: true, oldExists: true }))

    await expect(prepareAppleIapLedgerForAccountDeletion(db, 'user-1')).rejects.toMatchObject({
      reason: 'split_brain_both_ledgers_present',
    })
  })

  it('fails closed for account deletion when no ledger exists', async () => {
    const db = fakeDb(tables())

    await expect(prepareAppleIapLedgerForAccountDeletion(db, 'user-1')).rejects.toMatchObject({
      reason: 'no_iap_ledger_present',
    })
  })
})
