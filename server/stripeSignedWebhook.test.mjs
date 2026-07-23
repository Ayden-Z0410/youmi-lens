import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import Stripe from 'stripe'

describe('Stripe signed webhook integration', () => {
  it('verifies an SDK-generated test signature over the exact raw body', () => {
    const stripe = new Stripe('sk_test_')
    const secret = 'phase1b-local-signing-secret'
    const rawBody = Buffer.from(JSON.stringify({
      id: 'evt_phase1b_signed',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_phase1b' } },
    }))
    const signature = stripe.webhooks.generateTestHeaderString({
      payload: rawBody.toString('utf8'),
      secret,
    })

    expect(
      stripe.webhooks.constructEvent(rawBody, signature, secret),
    ).toMatchObject({ id: 'evt_phase1b_signed', type: 'customer.subscription.updated' })

    expect(() =>
      stripe.webhooks.constructEvent(Buffer.from(`${rawBody.toString('utf8')} `), signature, secret),
    ).toThrow()
  })

  it('mounts the raw webhook route before the global JSON parser', () => {
    const server = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8')
    const webhookRoute = server.indexOf("'/api/billing/stripe/webhook'")
    const rawParser = server.indexOf("express.raw({ type: 'application/json' })")
    const jsonParser = server.indexOf("app.use(express.json({ limit: '2mb' }))")

    expect(webhookRoute).toBeGreaterThan(-1)
    expect(rawParser).toBeGreaterThan(webhookRoute)
    expect(jsonParser).toBeGreaterThan(rawParser)
  })
})
