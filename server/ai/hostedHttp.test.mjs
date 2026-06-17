import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyJwt: vi.fn(),
  getOrCreateUserQuota: vi.fn(),
  checkHostedActionAllowed: vi.fn(),
  recordBetaUsage: vi.fn(),
  hostedCapabilities: vi.fn(),
  transcribeAudio: vi.fn(),
}))

vi.mock('../betaGate.mjs', () => ({
  verifyJwt: mocks.verifyJwt,
  getOrCreateUserQuota: mocks.getOrCreateUserQuota,
  checkHostedActionAllowed: mocks.checkHostedActionAllowed,
  recordBetaUsage: mocks.recordBetaUsage,
  BETA_ERROR_CODES: {
    AUTH_REQUIRED: 'auth_required',
  },
  BETA_LIMIT_MESSAGE: 'Free beta limit reached.',
}))

vi.mock('./hosted/youmiHosted.mjs', () => ({
  hostedCapabilities: mocks.hostedCapabilities,
  transcribeAudio: mocks.transcribeAudio,
}))

const { handleHostedTranscribe } = await import('./hostedHttp.mjs')

function resMock() {
  return {
    statusCode: 200,
    body: undefined,
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

describe('handleHostedTranscribe', () => {
  const originalForceTest = process.env.YOUMI_TRANSCRIBE_FORCE_TEST

  beforeEach(() => {
    process.env.YOUMI_TRANSCRIBE_FORCE_TEST = '1'
    mocks.verifyJwt.mockReset()
    mocks.getOrCreateUserQuota.mockReset()
    mocks.checkHostedActionAllowed.mockReset()
    mocks.recordBetaUsage.mockReset()
    mocks.hostedCapabilities.mockReset()
    mocks.transcribeAudio.mockReset()
    mocks.hostedCapabilities.mockReturnValue({ transcribe: true })
  })

  afterEach(() => {
    if (originalForceTest == null) {
      delete process.env.YOUMI_TRANSCRIBE_FORCE_TEST
    } else {
      process.env.YOUMI_TRANSCRIBE_FORCE_TEST = originalForceTest
    }
  })

  it('requires auth before returning the forced test transcript', async () => {
    mocks.verifyJwt.mockResolvedValue(null)
    const res = resMock()

    await handleHostedTranscribe({ headers: {}, body: {} }, res)

    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({
      error: 'auth_required',
      message: 'Sign in required.',
    })
    expect(mocks.getOrCreateUserQuota).not.toHaveBeenCalled()
    expect(mocks.transcribeAudio).not.toHaveBeenCalled()
  })

  it('still allows the forced test transcript after auth and quota pass', async () => {
    mocks.verifyJwt.mockResolvedValue({ userId: 'user-1', email: 'user@example.com' })
    mocks.getOrCreateUserQuota.mockResolvedValue({ user_id: 'user-1' })
    mocks.checkHostedActionAllowed.mockResolvedValue({ allowed: true })
    const res = resMock()

    await handleHostedTranscribe(
      { headers: { authorization: 'Bearer valid-token' }, body: {} },
      res,
    )

    expect(mocks.getOrCreateUserQuota).toHaveBeenCalledWith('user-1', 'user@example.com')
    expect(mocks.checkHostedActionAllowed).toHaveBeenCalledWith({ user_id: 'user-1' }, 'user-1')
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ text: 'test' })
    expect(mocks.transcribeAudio).not.toHaveBeenCalled()
  })
})
