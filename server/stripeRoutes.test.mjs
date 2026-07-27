import { describe, expect, it } from 'vitest'
import {
  buildCheckoutSessionParams,
  checkoutIdempotencyKey,
  createOrReuseCheckoutSession,
  handleCheckout,
  handlePortal,
  handleSubscriptionStatus,
  pickReusableOpenCheckoutSession,
  shouldBlockCheckoutForStripeSubscription,
  shouldBlockCheckoutForSubscription,
} from './stripeRoutes.mjs'
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

describe('shouldBlockCheckoutForSubscription (active-subscriber guard)', () => {
  it('blocks active and canceling (still active) subscribers', () => {
    expect(shouldBlockCheckoutForSubscription({ active: true, status: 'active', manageable: true })).toBe(true)
    expect(
      shouldBlockCheckoutForSubscription({
        active: true,
        status: 'active',
        cancelAtPeriodEnd: true,
        manageable: true,
      }),
    ).toBe(true)
  })

  it('blocks manageable past_due even when access is inactive', () => {
    expect(
      shouldBlockCheckoutForSubscription({ active: false, status: 'past_due', manageable: true }),
    ).toBe(true)
  })

  it('allows free/none and expired with no active paid access', () => {
    expect(shouldBlockCheckoutForSubscription({ active: false, status: 'none', manageable: false })).toBe(false)
    expect(shouldBlockCheckoutForSubscription({ active: false, status: 'expired', manageable: true })).toBe(false)
    expect(shouldBlockCheckoutForSubscription({ active: false, status: 'canceled', manageable: true })).toBe(false)
    expect(shouldBlockCheckoutForSubscription({ active: false, status: 'past_due', manageable: false })).toBe(false)
  })
})

describe('multi-tab Checkout race guards (Stripe-live)', () => {
  it('blocks active/trialing/past_due Stripe subscriptions before a new Checkout', () => {
    expect(shouldBlockCheckoutForStripeSubscription({ status: 'active' })).toBe(true)
    expect(shouldBlockCheckoutForStripeSubscription({ status: 'trialing' })).toBe(true)
    expect(shouldBlockCheckoutForStripeSubscription({ status: 'past_due' })).toBe(true)
    expect(shouldBlockCheckoutForStripeSubscription({ status: 'canceled' })).toBe(false)
    expect(shouldBlockCheckoutForStripeSubscription({ status: 'incomplete' })).toBe(false)
  })

  it('reuses an open same-plan Checkout Session URL', () => {
    const reusable = pickReusableOpenCheckoutSession(
      [
        {
          id: 'cs_other',
          status: 'open',
          mode: 'subscription',
          url: 'https://checkout.stripe.com/other',
          metadata: { user_id: 'user-1', plan_code: 'student_basic_annual' },
        },
        {
          id: 'cs_match',
          status: 'open',
          mode: 'subscription',
          url: 'https://checkout.stripe.com/match',
          metadata: { user_id: 'user-1', plan_code: 'student_basic_monthly' },
        },
      ],
      { userId: 'user-1', planCode: 'student_basic_monthly' },
    )
    expect(reusable?.id).toBe('cs_match')
  })

  it('scopes the Stripe idempotency key to user + price', () => {
    expect(checkoutIdempotencyKey('user-1', 'price_monthly')).toBe('billing:checkout:user-1:price_monthly')
  })

  it('createOrReuseCheckoutSession blocks when Stripe already has an active subscription', async () => {
    const stripe = {
      subscriptions: {
        list: async () => ({ data: [{ id: 'sub_live', status: 'active' }] }),
      },
      checkout: {
        sessions: {
          list: async () => ({ data: [] }),
          create: async () => {
            throw new Error('should not create')
          },
          expire: async () => {
            throw new Error('should not expire')
          },
        },
      },
    }
    await expect(
      createOrReuseCheckoutSession(stripe, {
        userId: 'user-1',
        customerId: 'cus_1',
        planCode: 'student_basic_monthly',
        priceId: 'price_monthly',
        urls: { successUrl: 'https://x/ok', cancelUrl: 'https://x/no' },
      }),
    ).rejects.toMatchObject({ code: 'subscription_already_exists' })
  })

  it('createOrReuseCheckoutSession reuses an open same-plan session instead of creating', async () => {
    const open = {
      id: 'cs_open',
      status: 'open',
      mode: 'subscription',
      url: 'https://checkout.stripe.com/open',
      metadata: { user_id: 'user-1', plan_code: 'student_basic_monthly' },
    }
    let created = 0
    const stripe = {
      subscriptions: { list: async () => ({ data: [] }) },
      checkout: {
        sessions: {
          list: async () => ({ data: [open] }),
          create: async () => {
            created += 1
            return { id: 'cs_new', url: 'https://checkout.stripe.com/new' }
          },
          expire: async () => {
            throw new Error('should not expire reusable')
          },
        },
      },
    }
    const result = await createOrReuseCheckoutSession(stripe, {
      userId: 'user-1',
      customerId: 'cus_1',
      planCode: 'student_basic_monthly',
      priceId: 'price_monthly',
      urls: { successUrl: 'https://x/ok', cancelUrl: 'https://x/no' },
    })
    expect(result).toEqual({ session: open, reused: true })
    expect(created).toBe(0)
  })

  it('createOrReuseCheckoutSession expires mismatched open sessions then creates with idempotency key', async () => {
    const expired = []
    const createArgs = []
    const stripe = {
      subscriptions: { list: async () => ({ data: [{ id: 'sub_old', status: 'canceled' }] }) },
      checkout: {
        sessions: {
          list: async () => ({
            data: [
              {
                id: 'cs_annual',
                status: 'open',
                mode: 'subscription',
                url: 'https://checkout.stripe.com/annual',
                metadata: { user_id: 'user-1', plan_code: 'student_basic_annual' },
              },
            ],
          }),
          expire: async (id) => {
            expired.push(id)
            return { id, status: 'expired' }
          },
          create: async (params, opts) => {
            createArgs.push({ params, opts })
            return { id: 'cs_new', url: 'https://checkout.stripe.com/new' }
          },
        },
      },
    }
    const result = await createOrReuseCheckoutSession(stripe, {
      userId: 'user-1',
      customerId: 'cus_1',
      planCode: 'student_basic_monthly',
      priceId: 'price_monthly',
      urls: { successUrl: 'https://x/ok', cancelUrl: 'https://x/no' },
    })
    expect(expired).toEqual(['cs_annual'])
    expect(result.reused).toBe(false)
    expect(result.session.url).toBe('https://checkout.stripe.com/new')
    expect(createArgs[0].opts).toEqual({ idempotencyKey: 'billing:checkout:user-1:price_monthly' })
    expect(createArgs[0].params.customer).toBe('cus_1')
    expect(createArgs[0].params.metadata).toEqual({
      user_id: 'user-1',
      plan_code: 'student_basic_monthly',
    })
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
