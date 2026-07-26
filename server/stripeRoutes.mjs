/**
 * Desktop Stripe billing routes (Commercialization V2 · 1A). The Website is the
 * billing center; Mac/Windows only read status and redirect here. No card data,
 * no client-supplied price/customer/entitlement — the server derives all trusted
 * values from the authenticated Supabase user.
 *
 *   POST /api/billing/checkout        — create a subscription Checkout Session.
 *   POST /api/billing/portal          — open the Stripe Customer Portal.
 *   GET  /api/subscription/status     — normalized, secret-free subscription state.
 *   POST /api/subscription/refresh    — pull latest from Stripe and re-project.
 */
import { verifyJwt } from './betaGate.mjs'
import { getActiveEntitlement } from './iapEntitlements.mjs'
import { getBillingAdminClient, getStripe, getStripeWebhookSecret, isStripeConfigured } from './stripeClient.mjs'
import {
  isAllowedPlanCode,
  priceIdForPlanCode,
  getCheckoutUrls,
} from './stripeConfig.mjs'
import { getOrCreateStripeCustomer, getStripeCustomerId } from './stripeCustomers.mjs'
import {
  applyStripeSubscription,
  buildSubscriptionStatus,
  deriveSubscriptionRecord,
  entitlementProjection,
} from './stripeSubscriptions.mjs'
import { handleStripeWebhook } from './stripeWebhook.mjs'

/**
 * Pure: build the Stripe Checkout Session params from SERVER-TRUSTED values only.
 * Nothing from the client body is read here — price, customer, and identity are
 * all derived server-side. The session is bound to the authenticated account via
 * client_reference_id + metadata.user_id (and subscription-level metadata).
 */
export function buildCheckoutSessionParams({ userId, customerId, planCode, priceId, urls }) {
  return {
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: userId,
    metadata: { user_id: userId, plan_code: planCode },
    subscription_data: { metadata: { user_id: userId, plan_code: planCode } },
    success_url: urls.successUrl || undefined,
    cancel_url: urls.cancelUrl || undefined,
    allow_promotion_codes: false,
  }
}

async function requireUser(req, res) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) {
    res.status(401).json({ ok: false, error: 'auth_required', message: 'Sign in required.' })
    return null
  }
  const user = await verifyJwt(token)
  if (!user) {
    res.status(401).json({ ok: false, error: 'auth_required', message: 'Invalid or expired session.' })
    return null
  }
  return user
}

/**
 * Defense-in-depth: block new Checkout when an existing paid relationship must
 * be managed (Portal), not replaced. Uses authoritative buildSubscriptionStatus
 * only — no schema/product changes.
 *
 * Block: active access, canceling (still active), past_due when manageable.
 * Allow: free/none, expired/canceled with no active paid access.
 */
export function shouldBlockCheckoutForSubscription(subscription) {
  if (!subscription || typeof subscription !== 'object') return false
  if (subscription.active === true) return true
  if (subscription.status === 'past_due' && subscription.manageable === true) return true
  return false
}

/**
 * Block Stripe Checkout when the user already holds an active student_pass
 * entitlement from ANY source (Apple IAP or Stripe). Stripe-only subscription
 * status would otherwise let an Apple-paid user start a second paid Checkout.
 */
export function shouldBlockCheckoutForEntitlement(entitlement) {
  if (!entitlement || typeof entitlement !== 'object') return false
  if (entitlement.status != null && entitlement.status !== 'active') return false
  if (entitlement.revoked_at) return false
  return entitlement.plan_type === 'student_pass'
}

// ── POST /api/billing/checkout ───────────────────────────────────────────────
export async function handleCheckout(req, res) {
  const user = await requireUser(req, res)
  if (!user) return

  const planCode = typeof req.body?.plan_code === 'string' ? req.body.plan_code : ''
  if (!isAllowedPlanCode(planCode)) {
    res.status(400).json({ ok: false, error: 'invalid_plan', message: 'Unknown subscription plan.' })
    return
  }
  const priceId = priceIdForPlanCode(planCode)
  if (!priceId) {
    res.status(503).json({ ok: false, error: 'plan_not_configured', message: 'This plan is not available yet.' })
    return
  }

  const db = getBillingAdminClient()
  const stripe = await getStripe()
  if (!db || !stripe) {
    res.status(503).json({ ok: false, error: 'stripe_not_configured', message: 'Billing is temporarily unavailable.' })
    return
  }

  try {
    const subscription = await buildSubscriptionStatus(db, user.userId, Date.now())
    if (shouldBlockCheckoutForSubscription(subscription)) {
      res.status(409).json({
        ok: false,
        error: 'subscription_already_exists',
        message:
          'You already have a subscription. Refresh your plan status or manage your existing subscription.',
      })
      return
    }

    const entitlement = await getActiveEntitlement(db, user.userId, new Date().toISOString())
    if (shouldBlockCheckoutForEntitlement(entitlement)) {
      res.status(409).json({
        ok: false,
        error: 'entitlement_already_active',
        message:
          'You already have an active Student Pass. Manage your existing subscription or App Store purchase instead of starting a new checkout.',
      })
      return
    }

    const customerId = await getOrCreateStripeCustomer(db, stripe, { userId: user.userId, email: user.email })
    const urls = getCheckoutUrls()
    const session = await stripe.checkout.sessions.create(
      buildCheckoutSessionParams({ userId: user.userId, customerId, planCode, priceId, urls }),
    )
    res.json({ ok: true, url: session.url })
  } catch (err) {
    console.error('[billing/checkout] failed', err instanceof Error ? err.message : String(err))
    res.status(502).json({ ok: false, error: 'checkout_failed', message: 'Could not start checkout.' })
  }
}

// ── POST /api/billing/portal ─────────────────────────────────────────────────
export async function handlePortal(req, res) {
  const user = await requireUser(req, res)
  if (!user) return

  const db = getBillingAdminClient()
  const stripe = await getStripe()
  if (!db || !stripe) {
    res.status(503).json({ ok: false, error: 'stripe_not_configured', message: 'Billing is temporarily unavailable.' })
    return
  }

  try {
    const customerId = await getStripeCustomerId(db, user.userId)
    if (!customerId) {
      res.status(409).json({ ok: false, error: 'no_customer', message: 'No billing account found. Subscribe first.' })
      return
    }
    const urls = getCheckoutUrls()
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: urls.portalReturnUrl || undefined,
    })
    res.json({ ok: true, url: session.url })
  } catch (err) {
    console.error('[billing/portal] failed', err instanceof Error ? err.message : String(err))
    res.status(502).json({ ok: false, error: 'portal_failed', message: 'Could not open the billing portal.' })
  }
}

// ── GET /api/subscription/status ─────────────────────────────────────────────
export async function handleSubscriptionStatus(req, res) {
  const user = await requireUser(req, res)
  if (!user) return

  const db = getBillingAdminClient()
  if (!db) {
    // No billing backend configured → report a safe "no subscription" shape.
    res.json({ ok: true, subscription: emptyStatus() })
    return
  }
  try {
    const subscription = await buildSubscriptionStatus(db, user.userId, Date.now())
    res.json({ ok: true, subscription })
  } catch (err) {
    console.error('[subscription/status] failed', err instanceof Error ? err.message : String(err))
    res.status(503).json({ ok: false, error: 'subscription_status_failed', message: 'Could not load subscription.' })
  }
}

function emptyStatus() {
  return {
    provider: null,
    active: false,
    planCode: null,
    billingInterval: null,
    status: 'none',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    graceUntil: null,
    manageable: false,
  }
}

// ── POST /api/subscription/refresh ───────────────────────────────────────────
// Pull the latest state from Stripe and re-project (covers webhook lag right
// after checkout). Falls back to stored state when Stripe is unavailable.
export async function handleSubscriptionRefresh(req, res) {
  const user = await requireUser(req, res)
  if (!user) return

  const db = getBillingAdminClient()
  if (!db) {
    res.json({ ok: true, refreshed: false, subscription: emptyStatus() })
    return
  }

  const stripe = isStripeConfigured() ? await getStripe() : null
  if (stripe) {
    try {
      const customerId = await getStripeCustomerId(db, user.userId)
      if (customerId) {
        const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 })
        const subs = Array.isArray(list?.data) ? list.data : []
        for (const sub of subs) {
          if (!sub?.metadata?.user_id) sub.metadata = { ...(sub.metadata || {}), user_id: user.userId }
          await applyStripeSubscription(db, sub, { nowMs: Date.now() })
        }
      }
    } catch (err) {
      console.warn('[subscription/refresh] stripe pull failed', err instanceof Error ? err.message : String(err))
    }
  }

  try {
    const subscription = await buildSubscriptionStatus(db, user.userId, Date.now())
    res.json({ ok: true, refreshed: Boolean(stripe), subscription })
  } catch (err) {
    console.error('[subscription/refresh] status failed', err instanceof Error ? err.message : String(err))
    res.status(503).json({ ok: false, error: 'subscription_refresh_failed', message: 'Could not refresh subscription.' })
  }
}

// ── Webhook wiring (raw body) ────────────────────────────────────────────────
export async function handleStripeWebhookRoute(req, res) {
  const db = getBillingAdminClient()
  const webhookSecret = getStripeWebhookSecret()
  const stripe = await getStripe()
  const constructEvent = stripe
    ? (raw, sig, secret) => stripe.webhooks.constructEvent(raw, sig, secret)
    : null
  await handleStripeWebhook(req, res, { db, webhookSecret, constructEvent })
}

// Re-export pure helpers for tests / callers.
export { deriveSubscriptionRecord, entitlementProjection }
