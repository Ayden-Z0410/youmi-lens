/**
 * Lazy, optional Stripe SDK + admin Supabase client for the Desktop billing
 * modules. Mirrors the getAdminClient() pattern in betaGate.mjs: returns null
 * when not configured so routes can fail soft (503) instead of throwing at
 * import time. The `stripe` package is imported dynamically so unit tests that
 * inject a fake client never need the dependency installed.
 */
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

let _admin = null
export function getBillingAdminClient() {
  if (!_admin && SUPABASE_URL && SERVICE_ROLE_KEY) {
    _admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return _admin
}

export function getStripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY?.trim() || ''
}

export function getStripeWebhookSecret() {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || ''
}

export function isStripeConfigured() {
  return Boolean(getStripeSecretKey())
}

let _stripe = null
let _stripeLoadFailed = false

/**
 * Stripe API version pinned for every request this server makes.
 *
 * Stripe Managed Payments rejects Checkout on versions older than
 * 2025-03-31.basil, so this is the minimum we may run. It is intentionally
 * NEWER than the version bundled with stripe-node 17.x (2025-02-24.acacia):
 * the SDK forwards this string as the `Stripe-Version` header, so the pin is
 * what the API actually applies.
 *
 * Basil moved `current_period_start`/`current_period_end` off the Subscription
 * root onto the subscription ITEM. `subscriptionPeriod()` in
 * stripeSubscriptions.mjs already reads the item as a fallback, so the
 * entitlement window stays correct under this version.
 */
export const STRIPE_API_VERSION = '2025-03-31.basil'

/**
 * Return a configured Stripe client, or null if unavailable (no secret key, or
 * the optional `stripe` package is not installed in this environment).
 */
export async function getStripe() {
  if (_stripe) return _stripe
  if (_stripeLoadFailed) return null
  const key = getStripeSecretKey()
  if (!key) return null
  try {
    const mod = await import('stripe')
    const Stripe = mod.default ?? mod
    _stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION })
    return _stripe
  } catch (err) {
    _stripeLoadFailed = true
    console.warn('[stripe] SDK unavailable', err instanceof Error ? err.message : String(err))
    return null
  }
}
