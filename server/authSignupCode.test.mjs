import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Env must be present BEFORE the SUT module evaluates its top-level config
// consts. vi.hoisted runs before the (hoisted) import below.
vi.hoisted(() => {
  process.env.SUPABASE_URL = 'https://stub.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-stub'
  process.env.BREVO_API_KEY = 'brevo-stub-key'
  process.env.BREVO_FROM_EMAIL = 'noreply@example.com'
})

const { recordMock } = vi.hoisted(() => ({ recordMock: vi.fn() }))

// Spy on the ledger write — Phase 5A is about WHEN/WITH-WHAT it is called.
vi.mock('./watchLedger.mjs', () => ({ recordWatchCostEvent: recordMock }))

// Fake service-role Supabase client: every signup_codes query resolves to an
// empty, error-free result (no existing user, no throttle hit, clean insert),
// which drives the handler straight through to the Brevo send.
vi.mock('@supabase/supabase-js', () => {
  const result = { data: [], error: null }
  const chain = () => {
    const c = {
      select: () => c,
      insert: () => c,
      update: () => c,
      upsert: () => c,
      eq: () => c,
      gte: () => c,
      lte: () => c,
      order: () => c,
      limit: () => c,
      single: () => c,
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    }
    return c
  }
  const client = {
    from: () => chain(),
    auth: { admin: { listUsers: async () => ({ data: { users: [] }, error: null }) } },
  }
  return { createClient: () => client }
})

import { handleSendSignupCode } from './authSignupCode.mjs'

const RECIPIENT = 'new.user@example.com'

function fakeReq(body) {
  return { body }
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

function brevoOk() {
  return vi.fn(async () => ({ ok: true }))
}
function brevoFail() {
  return vi.fn(async () => ({ ok: false, status: 502, text: async () => 'brevo down' }))
}

beforeEach(() => {
  recordMock.mockReset()
  recordMock.mockResolvedValue({ ok: true, id: 'evt-1' })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('handleSendSignupCode — Brevo usage ledger (Phase 5A)', () => {
  it('records exactly one internal usage event after a successful Brevo send', async () => {
    vi.stubGlobal('fetch', brevoOk())
    const res = fakeRes()
    await handleSendSignupCode(fakeReq({ email: RECIPIENT, username: 'New User' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(recordMock).toHaveBeenCalledTimes(1)
    expect(recordMock).toHaveBeenCalledWith({
      provider: 'brevo',
      event_type: 'email_send',
      quantity: 1,
      unit: 'emails',
      source: 'internal',
      status: 'recorded',
      user_id: null,
      recording_id: null,
      metadata: { email_purpose: 'signup_verification', template_type: 'verification_code' },
    })
  })

  it('does NOT record a ledger event when the Brevo send fails', async () => {
    vi.stubGlobal('fetch', brevoFail())
    const res = fakeRes()
    await handleSendSignupCode(fakeReq({ email: RECIPIENT, username: 'New User' }), res)

    expect(res.statusCode).toBe(502)
    expect(res.body?.error).toBe('email_send_failed')
    expect(recordMock).not.toHaveBeenCalled()
  })

  it('does not fail the email send when the ledger write returns an error', async () => {
    vi.stubGlobal('fetch', brevoOk())
    recordMock.mockResolvedValueOnce({ ok: false, error: 'insert_failed' })
    const res = fakeRes()
    await handleSendSignupCode(fakeReq({ email: RECIPIENT, username: 'New User' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(recordMock).toHaveBeenCalledTimes(1)
  })

  it('does not fail the email send when the ledger write throws', async () => {
    vi.stubGlobal('fetch', brevoOk())
    recordMock.mockRejectedValueOnce(new Error('unexpected'))
    const res = fakeRes()
    await handleSendSignupCode(fakeReq({ email: RECIPIENT, username: 'New User' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('stores no recipient, code, body, or secret in the ledger metadata', async () => {
    vi.stubGlobal('fetch', brevoOk())
    const res = fakeRes()
    await handleSendSignupCode(fakeReq({ email: RECIPIENT, username: 'New User' }), res)

    expect(recordMock).toHaveBeenCalledTimes(1)
    const arg = recordMock.mock.calls[0][0]

    // Metadata is exactly the two safe descriptors — nothing else.
    expect(Object.keys(arg.metadata).sort()).toEqual(['email_purpose', 'template_type'])
    // No user identity is attached on the signup path.
    expect(arg.user_id).toBeNull()
    expect(arg.recording_id).toBeNull()

    // The whole recorded payload must not leak the recipient, a verification
    // code, the email body/HTML, the Brevo API key, or any auth/header material.
    const serialized = JSON.stringify(arg).toLowerCase()
    expect(serialized).not.toContain(RECIPIENT.toLowerCase())
    expect(serialized).not.toContain('@example.com')
    expect(serialized).not.toContain('brevo-stub-key')
    expect(serialized).not.toContain('api-key')
    expect(serialized).not.toContain('htmlcontent')
    expect(serialized).not.toContain('verification code is')
    expect(serialized).not.toMatch(/\d{8}/) // no 8-digit code
  })
})
