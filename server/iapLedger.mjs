export const PREFERRED_LEDGER_TABLE = 'apple_iap_transactions'
export const LEGACY_LEDGER_TABLE = 'app_store_subscriptions'

export class AppleIapLedgerUnavailableError extends Error {
  constructor(reason, metadata = {}) {
    super('Apple IAP ledger is temporarily unavailable')
    this.name = 'AppleIapLedgerUnavailableError'
    this.reason = reason
    this.metadata = metadata
  }
}

export class AppleIapLegacyLedgerWriteError extends AppleIapLedgerUnavailableError {
  constructor(operation) {
    super('legacy_ledger_write_blocked', { operation })
    this.name = 'AppleIapLegacyLedgerWriteError'
  }
}

export function resetAppleIapLedgerTableCache() {
  // Phase 5A intentionally keeps no sticky legacy cache. This no-op preserves
  // the test/helper API and documents process-restart behavior: each operation
  // re-resolves table state, so a migration is detected by the next call.
}

export function isAppleIapLedgerUnavailableError(error) {
  return error instanceof AppleIapLedgerUnavailableError
}

export function isMissingAppleIapLedgerTableError(error) {
  if (!error) return false
  const code = String(error.code ?? '')
  const message = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase()

  if (code === '42P01') return true
  if (code !== 'PGRST205') return false

  return (
    message.includes('schema cache') &&
    message.includes('could not find the table')
  )
}

function logLedgerResolution(event, metadata = {}) {
  console.warn(
    '[iap-ledger]',
    JSON.stringify({
      severity: event === 'resolved' ? 'info' : 'high',
      event,
      preferredTable: PREFERRED_LEDGER_TABLE,
      legacyTable: LEGACY_LEDGER_TABLE,
      ...metadata,
    }),
  )
}

async function probeTable(db, table) {
  const { error } = await db.from(table).select('transaction_id').limit(1)
  if (!error) return { table, exists: true, error: null }
  if (isMissingAppleIapLedgerTableError(error)) return { table, exists: false, error }
  return { table, exists: null, error }
}

export async function resolveAppleIapLedgerTable(db, operation = 'query') {
  const preferred = await probeTable(db, PREFERRED_LEDGER_TABLE)
  const legacy = await probeTable(db, LEGACY_LEDGER_TABLE)

  if (preferred.exists === null) {
    logLedgerResolution('preferred_probe_failed', { operation, code: preferred.error?.code ?? null })
    throw new AppleIapLedgerUnavailableError('preferred_probe_failed', {
      operation,
      code: preferred.error?.code ?? null,
    })
  }
  if (legacy.exists === null) {
    logLedgerResolution('legacy_probe_failed', { operation, code: legacy.error?.code ?? null })
    throw new AppleIapLedgerUnavailableError('legacy_probe_failed', {
      operation,
      code: legacy.error?.code ?? null,
    })
  }

  if (preferred.exists && legacy.exists) {
    logLedgerResolution('split_brain_both_ledgers_present', { operation })
    throw new AppleIapLedgerUnavailableError('split_brain_both_ledgers_present', { operation })
  }
  if (!preferred.exists && !legacy.exists) {
    logLedgerResolution('no_iap_ledger_present', { operation })
    throw new AppleIapLedgerUnavailableError('no_iap_ledger_present', { operation })
  }

  const table = preferred.exists ? PREFERRED_LEDGER_TABLE : LEGACY_LEDGER_TABLE
  logLedgerResolution('resolved', { operation, table })
  return {
    table,
    mode: table === PREFERRED_LEDGER_TABLE ? 'new' : 'legacy',
  }
}

export async function runAppleIapLedgerQuery(db, queryFn, options = {}) {
  const operation = options.operation ?? 'query'
  const resolution = await resolveAppleIapLedgerTable(db, operation)
  const result = await queryFn(resolution.table, resolution)
  if (result?.error) return { ...result, ...resolution }
  return { ...(result ?? {}), error: null, ...resolution }
}

function bindingFromRow(row, table) {
  if (!row) return null
  if (table === PREFERRED_LEDGER_TABLE && row.owner_state === 'account_deleted') {
    return { userId: null, ownerState: 'account_deleted' }
  }
  if (row.user_id) return { userId: row.user_id, ownerState: row.owner_state ?? 'active' }
  return null
}

export async function findAppleIapTransactionBinding(db, { transactionId, originalTransactionId }) {
  const byTx = await runAppleIapLedgerQuery(
    db,
    (table) =>
      db
        .from(table)
        .select(table === PREFERRED_LEDGER_TABLE ? 'user_id, owner_state' : 'user_id')
        .eq('transaction_id', transactionId)
        .maybeSingle(),
    { operation: 'select_binding_by_transaction_id' },
  )
  const txBinding = bindingFromRow(byTx.data, byTx.table)
  if (txBinding) return txBinding

  if (originalTransactionId) {
    const byOrig = await runAppleIapLedgerQuery(
      db,
      (table) =>
        db
          .from(table)
          .select(table === PREFERRED_LEDGER_TABLE ? 'user_id, owner_state' : 'user_id')
          .eq('original_transaction_id', originalTransactionId)
          .limit(1),
      { operation: 'select_binding_by_original_transaction_id' },
    )
    const origBinding = bindingFromRow(byOrig.data?.[0], byOrig.table)
    if (origBinding) return origBinding
  }
  return null
}

function requireNewLedger(resolution, operation) {
  if (resolution.mode !== 'new') throw new AppleIapLegacyLedgerWriteError(operation)
}

export async function insertAppleIapTransaction(db, row) {
  return runAppleIapLedgerQuery(
    db,
    (table, resolution) => {
      requireNewLedger(resolution, 'insert_transaction')
      return db.from(table).insert(row)
    },
    { operation: 'insert_transaction' },
  )
}

export async function updateAppleIapTransactionByTransactionId(db, transactionId, updates) {
  return runAppleIapLedgerQuery(
    db,
    (table, resolution) => {
      requireNewLedger(resolution, 'update_transaction')
      return db.from(table).update(updates).eq('transaction_id', transactionId)
    },
    { operation: 'update_transaction' },
  )
}

export async function revokeAppleIapTransaction(db, transactionId, revokedAt) {
  return updateAppleIapTransactionByTransactionId(db, transactionId, {
    status: 'revoked',
    revoked_at: revokedAt,
    last_verified_at: new Date().toISOString(),
  })
}

export async function prepareAppleIapLedgerForAccountDeletion(db, userId, deletedAt = new Date().toISOString()) {
  const resolution = await resolveAppleIapLedgerTable(db, 'prepare_account_deletion')

  if (resolution.mode === 'legacy') {
    const { count, error } = await db
      .from(LEGACY_LEDGER_TABLE)
      .select('transaction_id', { count: 'exact', head: true })
      .eq('user_id', userId)
    if (error) throw error
    if ((count ?? 0) > 0) {
      return {
        ...resolution,
        allowed: false,
        blocked: true,
        reason: 'legacy_ledger_has_billing_rows',
        affectedRows: count ?? 0,
      }
    }
    return {
      ...resolution,
      allowed: true,
      blocked: false,
      reason: 'legacy_ledger_no_billing_rows',
      affectedRows: 0,
    }
  }

  const { error } = await db
    .from(PREFERRED_LEDGER_TABLE)
    .update({
      owner_state: 'account_deleted',
      account_deleted_at: deletedAt,
    })
    .eq('user_id', userId)
  if (error) throw error
  return {
    ...resolution,
    allowed: true,
    blocked: false,
    reason: 'new_ledger_marked_account_deleted',
  }
}

export async function markAppleIapTransactionsAccountDeleted(db, userId, deletedAt = new Date().toISOString()) {
  return prepareAppleIapLedgerForAccountDeletion(db, userId, deletedAt)
}
