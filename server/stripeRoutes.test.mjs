import { describe, expect, it } from 'vitest'
import { buildCheckoutSessionParams, handleCheckout, handlePortal, handleSubscriptionStatus } from './stripeRoutes.mjs'
import { getOrCreateStripeCustomer, getStripeCustomerId, linkStripeCustomer } from './stripeCustomers.mjs'
import { safeRedirectUrl } from './stripeConfig.mjs'

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this },
  }
}

describe('buildCheckoutSessionParams (server-trusted only)', () => {
  it('binds the session to the authenticated account via metadata + client_reference_id', () => {
    const params = buildCheckoutSessionParams({
      userId: 'user-1',
      customerId: 'cus_1',
      planCode: 'student_basic_monthly',
      priceId: 'price_monthly',
      urls: { successUrl: 'https://x/ok', cancelUrl: 'https://x/no' },
    })
    expect(params.mode).toBe('subscription')
    expect(params.customer).toBe('cus_1')
    expect(params.client_reference_id).toBe('user-1')
    expect(params.metadata).toEqual({ user_id: 'user-1', plan_code: 'student_basic_monthly' })
    expect(params.subscription_data.metadata.user_id).toBe('user-1')
  })

  it('uses ONLY the server-resolved price — no client-supplied amount/price is honored', () => {
    // The builder has no channel for a client price/amount; the only price it can
    // emit is the one the server passes in.
    const params = buildCheckoutSessionParams({
      userId: 'user-1',
      customerId: 'cus_1',
      planCode: 'student_basic_annual',
      priceId: 'price_annual',
      urls: {},
    })
    expect(params.line_items).toEqual([{ price: 'price_annual', quantity: 1 }])
    expect(params.allow_promotion_codes).toBe(false)
  })
})

describe('redirect URL safety (no open redirects / bad schemes)', () => {
  it('accepts absolute http(s) URLs', () => {
    expect(safeRedirectUrl('https://youmilens.com/account')).toBe('https://youmilens.com/account')
    expect(safeRedirectUrl('http://localhost:5173/account')).toBe('http://localhost:5173/account')
  })

  it('rejects non-web schemes and malformed/relative values', () => {
    expect(safeRedirectUrl('javascript:alert(1)')).toBe('')
    expect(safeRedirectUrl('/account')).toBe('')
    expect(safeRedirectUrl('not a url')).toBe('')
    expect(safeRedirectUrl('')).toBe('')
    expect(safeRedirectUrl(undefined)).toBe('')
  })
})

describe('checkout / portal / status authentication', () => {
  it('rejects checkout without a bearer token', async () => {
    const res = makeRes()
    await handleCheckout({ headers: {}, body: { plan_code: 'student_basic_monthly' } }, res)
    expect(res.statusCode).toBe(401)
    expect(res.body).toMatchObject({ error: 'auth_required' })
  })

  it('rejects portal without a bearer token', async () => {
    const res = makeRes()
    await handlePortal({ headers: {}, body: {} }, res)
    expect(res.statusCode).toBe(401)
  })

  it('rejects subscription status without a bearer token', async () => {
    const res = makeRes()
    await handleSubscriptionStatus({ headers: {} }, res)
    expect(res.statusCode).toBe(401)
  })
})

// ── Stripe customer mapping (reuse + concurrency) ────────────────────────────

function customerDb({ existing = null } = {}) {
  const state = { rows: existing ? [{ user_id: 'user-1', stripe_customer_id: existing }] : [] }
  const calls = { upserts: [] }
  const db = {
    from() {
      return {
        select() { return this },
        eq() { return this },
        async maybeSingle() {
          const row = state.rows[0]
          return { data: row ? { stripe_customer_id: row.stripe_customer_id } : null, error: null }
        },
        async upsert(row, opts) {
          calls.upserts.push({ row, opts })
          // ignoreDuplicates: only the first writer wins.
          if (state.rows.length === 0) state.rows.push(row)
          return { error: null }
        },
      }
    },
  }
  return { db, calls, state }
}

describe('Stripe customer reuse', () => {
  it('returns the existing customer without creating a new one', async () => {
    const { db } = customerDb({ existing: 'cus_existing' })
    let created = 0
    const stripe = { customers: { create: async () => { created++; return { id: 'cus_new' } } } }
    const id = await getOrCreateStripeCustomer(db, stripe, { userId: 'user-1', email: 'a@b.com' })
    expect(id).toBe('cus_existing')
    expect(created).toBe(0)
  })

  it('creates and links a customer exactly once for a new user', async () => {
    const { db, calls } = customerDb()
    let created = 0
    const stripe = { customers: { create: async () => { created++; return { id: 'cus_new' } } } }
    const id = await getOrCreateStripeCustomer(db, stripe, { userId: 'user-1', email: 'a@b.com' })
    expect(created).toBe(1)
    expect(id).toBe('cus_new')
    expect(calls.upserts[0].opts).toMatchObject({ onConflict: 'user_id', ignoreDuplicates: true })
  })

  it('linkStripeCustomer returns the authoritative stored id (race winner)', async () => {
    const { db } = customerDb({ existing: 'cus_winner' })
    // A late writer tries to link its own id, but the stored winner is returned.
    const id = await linkStripeCustomer(db, 'user-1', 'cus_late')
    expect(id).toBe('cus_winner')
    expect(await getStripeCustomerId(db, 'user-1')).toBe('cus_winner')
  })
})
