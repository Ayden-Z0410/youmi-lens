/**
 * Stripe API version pin.
 *
 * Stripe Managed Payments rejects Checkout on API versions older than
 * 2025-03-31.basil. The pin lives in stripeClient.mjs and is forwarded by the
 * SDK as the `Stripe-Version` header, so it — not the SDK's bundled version —
 * is what the API applies. These tests fail if the pin is ever lowered.
 */
import { describe, expect, it } from 'vitest'
import { STRIPE_API_VERSION } from './stripeClient.mjs'

/** Managed Payments minimum. Anything older is rejected at Checkout creation. */
const MANAGED_PAYMENTS_MINIMUM = '2025-03-31.basil'

/** `YYYY-MM-DD[.codename]` → comparable `YYYYMMDD` number. */
function releaseDate(version) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(version)
  if (!match) throw new Error(`unrecognised Stripe API version: ${version}`)
  return Number(`${match[1]}${match[2]}${match[3]}`)
}

describe('Stripe API version pin', () => {
  it('is exactly the Managed Payments compatible version', () => {
    expect(STRIPE_API_VERSION).toBe(MANAGED_PAYMENTS_MINIMUM)
  })

  it('is not older than the Managed Payments minimum', () => {
    expect(releaseDate(STRIPE_API_VERSION)).toBeGreaterThanOrEqual(releaseDate(MANAGED_PAYMENTS_MINIMUM))
  })

  it('is not the pre-Managed-Payments version that Checkout rejected', () => {
    expect(STRIPE_API_VERSION).not.toBe('2024-06-20')
  })

  it('is the version the client actually sends to Stripe', async () => {
    // Constructing the SDK with our pin must not throw and must be forwarded
    // verbatim — stripe-node 17.x bundles an older version, and only the
    // forwarded header decides which API the request runs against.
    const { default: Stripe } = await import('stripe')
    const client = new Stripe('sk_test_pin_assertion_only', { apiVersion: STRIPE_API_VERSION })
    expect(client.getApiField('version')).toBe(STRIPE_API_VERSION)
  })
})
