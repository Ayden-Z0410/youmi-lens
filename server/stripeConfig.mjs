/**
 * Desktop Stripe configuration + pure plan mapping (Commercialization V2 · 1A).
 *
 * The SERVER is the only authority for which plans exist and which Stripe price
 * each maps to. The client never supplies a price, amount, plan_type, or
 * customer id — it may only name a plan_code, which is validated here.
 *
 * All price ids come from environment variables so no unverified live Stripe id
 * is baked into the repo. Both plan codes map to the SAME entitlement tier
 * (plan_type = 'student_pass'); only the billing interval differs.
 */

export const STUDENT_PASS_PLAN_TYPE = 'student_pass'

export const PLAN_CODES = {
  STUDENT_BASIC_MONTHLY: 'student_basic_monthly',
  STUDENT_BASIC_ANNUAL: 'student_basic_annual',
}

/** Billing interval per plan_code (record-level; NOT an entitlement tier). */
const PLAN_INTERVALS = {
  [PLAN_CODES.STUDENT_BASIC_MONTHLY]: 'month',
  [PLAN_CODES.STUDENT_BASIC_ANNUAL]: 'year',
}

/**
 * Past-due grace window (days) before access is withdrawn.
 *
 * PRODUCT POLICY: grace is NOT an approved business decision yet, so the default
 * is ZERO days. Access during past_due is therefore never extended beyond the
 * already-paid boundary (Stripe's current_period_start after a failed renewal)
 * unless STRIPE_GRACE_PERIOD_DAYS is explicitly set to a positive value. The knob
 * is preserved so a grace policy can be turned on later without a code change.
 */
export function getGracePeriodDays() {
  const raw = Number(process.env.STRIPE_GRACE_PERIOD_DAYS)
  return Number.isFinite(raw) && raw >= 0 ? raw : 0
}

/** A configured value that is still a repo placeholder must never be sold. */
function isPlaceholderPriceId(value) {
  return !value || value.startsWith('price_REPLACE_ME')
}

/**
 * plan_code → configured Stripe price id (env only). Returns '' when unset OR
 * when the value is still a placeholder, so dormant/placeholder products can
 * never be accidentally charged.
 */
export function priceIdForPlanCode(planCode) {
  const map = {
    [PLAN_CODES.STUDENT_BASIC_MONTHLY]: process.env.STRIPE_PRICE_STUDENT_BASIC_MONTHLY?.trim() || '',
    [PLAN_CODES.STUDENT_BASIC_ANNUAL]: process.env.STRIPE_PRICE_STUDENT_BASIC_ANNUAL?.trim() || '',
  }
  const value = map[planCode] || ''
  return isPlaceholderPriceId(value) ? '' : value
}

/** Reverse lookup: Stripe price id → plan_code (from env config). Null if none. */
export function planCodeForPriceId(priceId) {
  if (!priceId) return null
  for (const planCode of Object.values(PLAN_CODES)) {
    if (priceIdForPlanCode(planCode) === priceId) return planCode
  }
  return null
}

export function isAllowedPlanCode(planCode) {
  return Object.values(PLAN_CODES).includes(planCode)
}

export function billingIntervalForPlanCode(planCode) {
  return PLAN_INTERVALS[planCode] ?? null
}

/** Both plan codes are the same tier. */
export function planTypeForPlanCode(planCode) {
  return isAllowedPlanCode(planCode) ? STUDENT_PASS_PLAN_TYPE : null
}

/**
 * Only accept an absolute http(s) URL. Redirect targets are server-configured
 * (never client-supplied), and this additionally rejects malformed / non-web
 * schemes (e.g. javascript:) so a misconfiguration cannot become an open
 * redirect. Returns '' for anything not a valid http(s) absolute URL.
 */
export function safeRedirectUrl(value) {
  const raw = (value || '').trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? raw : ''
  } catch {
    return ''
  }
}

/** Checkout success/cancel + portal return URLs (Website; env-configured, validated). */
export function getCheckoutUrls() {
  const base = process.env.STRIPE_CHECKOUT_RETURN_ORIGIN?.trim() || process.env.WEBSITE_ORIGIN?.trim() || ''
  const withBase = (explicit, path) =>
    safeRedirectUrl(explicit) || (base ? safeRedirectUrl(`${base}${path}`) : '')
  return {
    successUrl: withBase(process.env.STRIPE_CHECKOUT_SUCCESS_URL, '/account?checkout=success'),
    cancelUrl: withBase(process.env.STRIPE_CHECKOUT_CANCEL_URL, '/pricing?checkout=cancelled'),
    portalReturnUrl: withBase(process.env.STRIPE_PORTAL_RETURN_URL, '/account'),
  }
}
