/**
 * Username contract for the shared signup-code flow.
 *
 * Before this change the handler created the Supabase Auth user FIRST and then
 * upserted the profile row, swallowing the error. A username collision therefore
 * produced a half-built account: an auth user with no profiles row. These tests
 * pin the corrected order and the collision handling.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

vi.hoisted(() => {
  process.env.SUPABASE_URL = 'https://stub.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-stub'
  process.env.BREVO_API_KEY = 'brevo-stub-key'
  process.env.BREVO_FROM_EMAIL = 'noreply@example.com'
})

const { state } = vi.hoisted(() => ({
  state: {
    profiles: [], // rows returned by the availability ILIKE query
    signupCodes: [], // rows returned when verifying
    inserted: [], // signup_codes inserts (pending username storage)
    upserts: [], // profiles upserts
    upsertError: null, // error the profiles upsert should return
    createdUser: { id: 'user-1234-abcd', email: 'new@example.com' },
    createUserError: null,
    createUserArgs: null,
    deletedUsers: [], // auth.admin.deleteUser calls — cleanup evidence
    deleteError: null,
  },
}))

vi.mock('./watchLedger.mjs', () => ({ recordWatchCostEvent: vi.fn(async () => ({ ok: true })) }))

vi.mock('@supabase/supabase-js', () => {
  const makeChain = (table) => {
    const ctx = { table, op: null, payload: null }
    const chain = {
      select: () => chain,
      ilike: () => chain,
      insert: (v) => { ctx.op = 'insert'; ctx.payload = v; if (table === 'signup_codes') state.inserted.push(v); return chain },
      upsert: (v) => { ctx.op = 'upsert'; ctx.payload = v; if (table === 'profiles') state.upserts.push(v); return chain },
      update: () => chain,
      eq: () => chain,
      gte: () => chain,
      order: () => chain,
      limit: () => chain,
      then: (resolve, reject) => {
        let result
        if (ctx.op === 'upsert' && table === 'profiles') result = { data: null, error: state.upsertError }
        else if (ctx.op === 'insert') result = { data: null, error: null }
        else if (table === 'profiles') result = { data: state.profiles, error: null }
        else if (table === 'signup_codes') result = { data: state.signupCodes, error: null }
        else result = { data: [], error: null }
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    return chain
  }
  const client = {
    from: (table) => makeChain(table),
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: [] }, error: null }),
        createUser: async (args) => {
          state.createUserArgs = args
          if (state.createUserError) return { data: null, error: state.createUserError }
          return { data: { user: state.createdUser }, error: null }
        },
        deleteUser: async (id) => { state.deletedUsers.push(id); return { error: state.deleteError } },
      },
    },
  }
  return { createClient: () => client }
})

import { handleSendSignupCode, handleVerifySignupCodeAndCreateUser } from './authSignupCode.mjs'

const EMAIL = 'new@example.com'
const req = (body) => ({ body })
const res = () => ({
  statusCode: 200, body: null,
  status(c) { this.statusCode = c; return this },
  json(o) { this.body = o; return this },
})

const validCode = '12345678'
/** Same salted hash the handler stores: sha256(`${code}:${email}`). */
function codeHash(code, email) {
  return createHash('sha256').update(`${code}:${email}`).digest('hex')
}
function pendingRow(username) {
  return {
    id: 'row-1', email: EMAIL, username, attempts: 0,
    code_hash: codeHash(validCode, EMAIL),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  }
}

beforeEach(() => {
  state.profiles = []
  state.signupCodes = []
  state.inserted = []
  state.upserts = []
  state.upsertError = null
  state.createUserError = null
  state.createUserArgs = null
  state.deletedUsers = []
  state.deleteError = null
  global.fetch = vi.fn(async () => ({ ok: true, status: 201, text: async () => '' }))
})

describe('send-signup-code — username validation and availability', () => {
  it('rejects an empty / too-short / too-long / control-char username before anything else', async () => {
    for (const bad of ['', ' ', 'a', 'x'.repeat(65), 'abcd']) {
      const r = res()
      await handleSendSignupCode(req({ email: EMAIL, username: bad }), r)
      expect(r.statusCode, JSON.stringify(bad)).toBe(400)
      expect(r.body.error).toBe('invalid_request')
    }
    expect(global.fetch).not.toHaveBeenCalled() // no email for any invalid name
  })

  it('accepts Unicode, inner spaces and punctuation (no alphanumeric-only rule)', async () => {
    for (const good of ['张同学', 'Ayden 张', 'Summer  Z', 'a_b%c']) {
      const r = res()
      await handleSendSignupCode(req({ email: EMAIL, username: good }), r)
      expect(r.statusCode, good).toBe(200)
    }
  })

  it('rejects a case-insensitive duplicate and sends NO email', async () => {
    state.profiles = [{ username: 'Summer' }]
    const r = res()
    await handleSendSignupCode(req({ email: EMAIL, username: '  sUmMeR  ' }), r)
    expect(r.statusCode).toBe(409)
    expect(r.body.error).toBe('username_taken')
    expect(r.body.message).toBe('This username is already taken. Try another one.')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('a wildcard-looking username cannot false-positive as taken', async () => {
    // ILIKE narrows; the exact lower(trim()) re-compare in JS decides.
    state.profiles = [{ username: 'axbxc' }]
    const r = res()
    await handleSendSignupCode(req({ email: EMAIL, username: 'a%c' }), r)
    expect(r.statusCode).toBe(200)
  })

  it('stores the trimmed username with the pending signup code', async () => {
    const r = res()
    await handleSendSignupCode(req({ email: EMAIL, username: '  Summer Zhang  ' }), r)
    expect(r.statusCode).toBe(200)
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted[0].username).toBe('Summer Zhang')
  })

  it('never leaks who owns a taken username', async () => {
    state.profiles = [{ username: 'summer', id: 'other-user', email: 'owner@example.com' }]
    const r = res()
    await handleSendSignupCode(req({ email: EMAIL, username: 'summer' }), r)
    const serialized = JSON.stringify(r.body)
    expect(serialized).not.toMatch(/other-user|owner@example\.com/)
    expect(Object.keys(r.body).sort()).toEqual(['error', 'message', 'ok'])
  })
})

describe('verify-signup-code-and-create-user — collision safety', () => {
  it('checks availability BEFORE creating the auth user', async () => {
    state.profiles = [{ username: 'summer' }]
    state.signupCodes = [pendingRow('summer')]
    const r = res()
    await handleVerifySignupCodeAndCreateUser(
      req({ email: EMAIL, username: 'Summer', password: 'password123', code: validCode }), r)
    expect(r.statusCode).toBe(409)
    expect(r.body.error).toBe('username_taken')
    // the decisive assertion: no auth user was ever created
    expect(state.createUserArgs).toBeNull()
    expect(state.deletedUsers).toHaveLength(0)
  })

  it('rejects an invalid username shape before touching the database', async () => {
    const r = res()
    await handleVerifySignupCodeAndCreateUser(
      req({ email: EMAIL, username: 'a', password: 'password123', code: validCode }), r)
    expect(r.statusCode).toBe(400)
    expect(state.createUserArgs).toBeNull()
  })
})

describe('verify — creation, race handling and cleanup', () => {
  const goodReq = () => req({ email: EMAIL, username: '  Summer Zhang  ', password: 'password123', code: validCode })

  it('passes the trimmed username to createUser and the profile row', async () => {
    state.signupCodes = [pendingRow('Summer Zhang')]
    const r = res()
    await handleVerifySignupCodeAndCreateUser(goodReq(), r)
    expect(r.statusCode).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(state.createUserArgs.user_metadata.username).toBe('Summer Zhang')
    expect(state.upserts[0].username).toBe('Summer Zhang')
    expect(state.deletedUsers).toHaveLength(0)
  })

  it('a unique-index race returns username_taken and deletes the new auth user', async () => {
    state.signupCodes = [pendingRow('Summer Zhang')]
    state.upsertError = { code: '23505', message: 'duplicate key value violates unique constraint "profiles_username_lower_unique"' }
    const r = res()
    await handleVerifySignupCodeAndCreateUser(goodReq(), r)
    expect(r.statusCode).toBe(409)
    expect(r.body.error).toBe('username_taken')
    expect(r.body.message).toBe('This username is already taken. Try another one.')
    // no half-built account is left behind
    expect(state.deletedUsers).toEqual([state.createdUser.id])
  })

  it('when race cleanup fails, does not claim username_taken (account can sign in)', async () => {
    state.signupCodes = [pendingRow('Summer Zhang')]
    state.upsertError = { code: '23505', message: 'duplicate key value violates unique constraint "profiles_username_lower_unique"' }
    state.deleteError = { message: 'delete failed' }
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = res()
    await handleVerifySignupCodeAndCreateUser(goodReq(), r)
    expect(r.statusCode).toBe(500)
    expect(r.body.error).toBe('account_created_sign_in_required')
    expect(r.body.message).toMatch(/sign in/i)
    expect(state.deletedUsers).toEqual([state.createdUser.id])
    errSpy.mockRestore()
  })

  it('detects the race by constraint name even without a SQLSTATE', async () => {
    state.signupCodes = [pendingRow('Summer Zhang')]
    state.upsertError = { message: 'profiles_username_lower_unique violated' }
    const r = res()
    await handleVerifySignupCodeAndCreateUser(goodReq(), r)
    expect(r.body.error).toBe('username_taken')
    expect(state.deletedUsers).toEqual([state.createdUser.id])
  })

  it('a non-unique profile-write failure is surfaced, not silently swallowed', async () => {
    state.signupCodes = [pendingRow('Summer Zhang')]
    state.upsertError = { code: '08006', message: 'connection failure' }
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = res()
    await handleVerifySignupCodeAndCreateUser(goodReq(), r)
    // account remains usable via user_metadata.username, but the failure is logged at error level
    expect(r.statusCode).toBe(200)
    expect(errSpy).toHaveBeenCalledWith('[verify-signup-code] profile upsert failed', 'connection failure')
    expect(state.deletedUsers).toHaveLength(0) // not a collision — do not delete the user
    errSpy.mockRestore()
  })

  it('logs only sanitized metadata when cleaning up a race', async () => {
    state.signupCodes = [pendingRow('Summer Zhang')]
    state.upsertError = { code: '23505', message: 'duplicate key' }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = res()
    await handleVerifySignupCodeAndCreateUser(goodReq(), r)
    const logged = warnSpy.mock.calls.map((c) => c.join(' ')).join(' ')
    expect(logged).not.toMatch(/new@example\.com|Summer Zhang|password123|12345678/)
    expect(logged).toMatch(/userIdPrefix/)
    warnSpy.mockRestore()
  })
})

describe('authSignupCode module contract', () => {
  it('exports the shared username bounds and taken copy', async () => {
    const m = await import('./authSignupCode.mjs')
    expect(m.USERNAME_MIN_LENGTH).toBe(2)
    expect(m.USERNAME_MAX_LENGTH).toBe(64)
    expect(m.USERNAME_TAKEN_MESSAGE).toBe('This username is already taken. Try another one.')
    expect(m.usernameKey('  SuMMer  ')).toBe('summer')
  })
})
