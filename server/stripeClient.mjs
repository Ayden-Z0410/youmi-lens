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
    _stripe = new Stripe(key, { apiVersion: '2024-06-20' })
    return _stripe
  } catch (err) {
    _stripeLoadFailed = true
    console.warn('[stripe] SDK unavailable', err instanceof Error ? err.message : String(err))
    return null
  }
}
