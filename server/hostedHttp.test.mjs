import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  checkHostedActionAllowedMock,
  getEffectiveQuotaMock,
  hostedCapabilitiesMock,
  recordBetaUsageMock,
  recordDashscopeChatUsageMock,
  summarizeTranscriptMock,
  verifyJwtMock,
} = vi.hoisted(() => ({
  checkHostedActionAllowedMock: vi.fn(),
  getEffectiveQuotaMock: vi.fn(),
  hostedCapabilitiesMock: vi.fn(),
  recordBetaUsageMock: vi.fn(),
  recordDashscopeChatUsageMock: vi.fn(),
  summarizeTranscriptMock: vi.fn(),
  verifyJwtMock: vi.fn(),
}))

vi.mock('./ai/hosted/youmiHosted.mjs', () => ({
  hostedCapabilities: hostedCapabilitiesMock,
  summarizeTranscript: summarizeTranscriptMock,
}))

vi.mock('./betaGate.mjs', () => ({
  BETA_ERROR_CODES: {
    AUTH_REQUIRED: 'auth_required',
    SUSPENDED: 'quota_suspended',
  },
  BETA_LIMIT_MESSAGE: 'Free beta limit reached.',
  checkHostedActionAllowed: checkHostedActionAllowedMock,
  getEffectiveQuota: getEffectiveQuotaMock,
  recordBetaUsage: recordBetaUsageMock,
  verifyJwt: verifyJwtMock,
}))

vi.mock('./watchModelUsage.mjs', () => ({
  recordDashscopeChatUsage: recordDashscopeChatUsageMock,
}))

import { handleHostedSummarize } from './ai/hostedHttp.mjs'

const DASH_SCOPE_USAGE = {
  provider: 'dashscope',
  model: 'qwen-plus',
  prompt_tokens: 1234,
  completion_tokens: 123,
}

function fakeReq(body = {}) {
  return {
    headers: { authorization: 'Bearer jwt-token' },
    body,
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

beforeEach(() => {
  vi.clearAllMocks()
  hostedCapabilitiesMock.mockReturnValue({ summarize: true })
  verifyJwtMock.mockResolvedValue({ userId: 'user-1', email: 'student@example.com' })
  getEffectiveQuotaMock.mockResolvedValue({ user_id: 'user-1', plan_type: 'student_pass', status: 'active' })
  checkHostedActionAllowedMock.mockResolvedValue({ allowed: true })
  recordDashscopeChatUsageMock.mockResolvedValue({ recorded: 2 })
  recordBetaUsageMock.mockResolvedValue(undefined)
})

describe('handleHostedSummarize', () => {
  it('records confirmed DashScope usage for direct hosted summaries', async () => {
    summarizeTranscriptMock.mockResolvedValue({
      summaryEn: 'Summary in English',
      summaryZh: 'Summary in Chinese',
      usage: DASH_SCOPE_USAGE,
    })
    const res = fakeRes()

    await handleHostedSummarize(
      fakeReq({ transcript: 'lecture transcript', course: 'Biology', title: 'Cell division' }),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ summary_en: 'Summary in English', summary_zh: 'Summary in Chinese' })
    expect(recordDashscopeChatUsageMock).toHaveBeenCalledTimes(1)
    expect(recordDashscopeChatUsageMock).toHaveBeenCalledWith({
      usage: DASH_SCOPE_USAGE,
      userId: 'user-1',
      recordingId: null,
      eventType: 'summary',
      feature: 'after_class_summary',
    })
    expect(recordBetaUsageMock).toHaveBeenCalledWith(
      'user-1',
      'student@example.com',
      null,
      'summary_generation',
      0,
    )
  })
})
