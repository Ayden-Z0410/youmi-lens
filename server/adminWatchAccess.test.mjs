import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyJwtMock, getOrCreateUserQuotaMock } = vi.hoisted(() => ({
  verifyJwtMock: vi.fn(),
  getOrCreateUserQuotaMock: vi.fn(),
}))

vi.mock('./betaGate.mjs', () => ({
  verifyJwt: verifyJwtMock,
  getOrCreateUserQuota: getOrCreateUserQuotaMock,
}))

import { checkWatchAdmin, requireWatchAdmin } from './adminWatchAccess.mjs'

function reqWithBearer(token = 'tok') {
  return { headers: { authorization: `Bearer ${token}` } }
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c
      return this
    },
    json(o) {
      this.body = o
      return this
    },
  }
}

beforeEach(() => {
  verifyJwtMock.mockReset()
  getOrCreateUserQuotaMock.mockReset()
  verifyJwtMock.mockResolvedValue({ userId: 'u1', email: 'admin@example.com' })
})

describe('checkWatchAdmin', () => {
  it('authorizes active admin quota rows', async () => {
    getOrCreateUserQuotaMock.mockResolvedValue({ plan_type: 'admin', status: 'active' })

    await expect(checkWatchAdmin(reqWithBearer())).resolves.toMatchObject({
      authorized: true,
      reason: 'ok',
    })
  })

  it('denies suspended privileged quota rows before plan-type authorization', async () => {
    getOrCreateUserQuotaMock.mockResolvedValue({ plan_type: 'admin', status: 'suspended' })

    await expect(checkWatchAdmin(reqWithBearer())).resolves.toMatchObject({
      authorized: false,
      reason: 'quota_suspended',
    })
  })
})

describe('requireWatchAdmin', () => {
  it('returns 403 for suspended admins and does not return the verified user', async () => {
    getOrCreateUserQuotaMock.mockResolvedValue({ plan_type: 'admin', status: 'suspended' })
    const res = fakeRes()

    await expect(requireWatchAdmin(reqWithBearer(), res)).resolves.toBeNull()
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({
      ok: false,
      error: 'forbidden',
      reason: 'quota_suspended',
    })
  })
})
