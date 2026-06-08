import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  checkAppleIapLedgerAccountDeletionAllowedMock,
  getAdminClientMock,
  isAppleIapLedgerUnavailableErrorMock,
  isMissingAppleIapLedgerTableErrorMock,
  prepareAppleIapLedgerForAccountDeletionMock,
  restoreAppleIapLedgerAfterAccountDeletionFailureMock,
  verifyJwtMock,
} = vi.hoisted(() => ({
  checkAppleIapLedgerAccountDeletionAllowedMock: vi.fn(),
  getAdminClientMock: vi.fn(),
  isAppleIapLedgerUnavailableErrorMock: vi.fn(),
  isMissingAppleIapLedgerTableErrorMock: vi.fn(),
  prepareAppleIapLedgerForAccountDeletionMock: vi.fn(),
  restoreAppleIapLedgerAfterAccountDeletionFailureMock: vi.fn(),
  verifyJwtMock: vi.fn(),
}))

vi.mock('./betaGate.mjs', () => ({
  BETA_ERROR_CODES: { AUTH_REQUIRED: 'auth_required' },
  getAdminClient: getAdminClientMock,
  verifyJwt: verifyJwtMock,
}))

vi.mock('./iapLedger.mjs', () => ({
  checkAppleIapLedgerAccountDeletionAllowed: checkAppleIapLedgerAccountDeletionAllowedMock,
  isAppleIapLedgerUnavailableError: isAppleIapLedgerUnavailableErrorMock,
  isMissingAppleIapLedgerTableError: isMissingAppleIapLedgerTableErrorMock,
  prepareAppleIapLedgerForAccountDeletion: prepareAppleIapLedgerForAccountDeletionMock,
  restoreAppleIapLedgerAfterAccountDeletionFailure: restoreAppleIapLedgerAfterAccountDeletionFailureMock,
}))

import { handleDeleteAccount } from './accountRoutes.mjs'

const USER_ID = 'user-123456789'

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

function deleteBuilder(deleteCalls) {
  return {
    delete() {
      return {
        eq(column, value) {
          deleteCalls.push({ column, value })
          return { error: null }
        },
      }
    },
  }
}

function makeDb({ storageListError = null, authDeleteError = null } = {}) {
  const deleteCalls = []
  const list = vi.fn().mockResolvedValue({ data: [], error: storageListError })
  const remove = vi.fn().mockResolvedValue({ data: [], error: null })
  const deleteUser = vi.fn().mockResolvedValue({ error: authDeleteError })
  return {
    deleteCalls,
    storage: {
      from: vi.fn(() => ({ list, remove })),
    },
    from: vi.fn(() => deleteBuilder(deleteCalls)),
    auth: {
      admin: { deleteUser },
    },
  }
}

describe('handleDeleteAccount Apple IAP deletion safety', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    getAdminClientMock.mockReset()
    verifyJwtMock.mockReset()
    checkAppleIapLedgerAccountDeletionAllowedMock.mockReset()
    prepareAppleIapLedgerForAccountDeletionMock.mockReset()
    restoreAppleIapLedgerAfterAccountDeletionFailureMock.mockReset()
    isAppleIapLedgerUnavailableErrorMock.mockReturnValue(false)
    isMissingAppleIapLedgerTableErrorMock.mockReturnValue(false)
    verifyJwtMock.mockResolvedValue({ userId: USER_ID })
    checkAppleIapLedgerAccountDeletionAllowedMock.mockResolvedValue({
      table: 'apple_iap_transactions',
      mode: 'new',
      allowed: true,
      blocked: false,
    })
    prepareAppleIapLedgerForAccountDeletionMock.mockResolvedValue({
      table: 'apple_iap_transactions',
      mode: 'new',
      allowed: true,
      blocked: false,
      reason: 'new_ledger_marked_account_deleted',
    })
    restoreAppleIapLedgerAfterAccountDeletionFailureMock.mockResolvedValue({
      table: 'apple_iap_transactions',
      mode: 'new',
      allowed: true,
    })
  })

  it('does not mark Apple IAP transactions deleted when storage deletion fails first', async () => {
    const db = makeDb({ storageListError: { message: 'storage unavailable' } })
    getAdminClientMock.mockReturnValue(db)
    const res = fakeRes()

    await handleDeleteAccount({ headers: { authorization: 'Bearer token' } }, res)

    expect(res.statusCode).toBe(500)
    expect(checkAppleIapLedgerAccountDeletionAllowedMock).toHaveBeenCalledWith(db, USER_ID)
    expect(prepareAppleIapLedgerForAccountDeletionMock).not.toHaveBeenCalled()
    expect(restoreAppleIapLedgerAfterAccountDeletionFailureMock).not.toHaveBeenCalled()
    expect(db.auth.admin.deleteUser).not.toHaveBeenCalled()
  })

  it('restores Apple IAP ownership if auth deletion fails after the final ledger mark', async () => {
    const db = makeDb({ authDeleteError: { message: 'auth service unavailable' } })
    getAdminClientMock.mockReturnValue(db)
    const res = fakeRes()

    await handleDeleteAccount({ headers: { authorization: 'Bearer token' } }, res)

    expect(res.statusCode).toBe(500)
    expect(prepareAppleIapLedgerForAccountDeletionMock).toHaveBeenCalledWith(db, USER_ID, expect.any(String))
    expect(db.auth.admin.deleteUser).toHaveBeenCalledWith(USER_ID)
    expect(restoreAppleIapLedgerAfterAccountDeletionFailureMock).toHaveBeenCalledWith(db, USER_ID, expect.any(String))
  })
})
