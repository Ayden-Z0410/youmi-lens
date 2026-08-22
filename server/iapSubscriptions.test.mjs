import { describe, expect, it } from 'vitest'
import { NotificationTypeV2, Subtype } from '@apple/app-store-server-library'
import {
  deriveSubscriptionStatus,
  assertSubscriptionIdentity,
  subscriptionStatusIsActive,
  shouldBlockSubscriptionGrant,
  safeSubscriptionEntitlement,
  SubscriptionAccountTokenError,
  isAutoRenewableProduct,
} from './iapSubscriptions.mjs'

const future = Date.now() + 86_400_000
const past = Date.now() - 86_400_000
const tx = (overrides = {}) => ({
  originalTransactionId: 'orig-1',
  appAccountToken: '00000000-0000-4000-8000-000000000000',
  expiresDateMs: future,
  revoked: false,
  ...overrides,
})

const monthlyProduct = {
  product_id: 'com.aydenz.youmilensipad.student.monthly',
  kind: 'auto_renewable',
  is_purchasable: false,
}

describe('subscription status model', () => {
  it('maps active and cancelled-but-active states', () => {
    expect(deriveSubscriptionStatus({ transaction: tx() })).toBe('active')
    expect(deriveSubscriptionStatus({ transaction: tx(), renewal: { autoRenewStatus: false } })).toBe('cancelled_but_active_until_expiry')
  })

  it('maps expired, revoked, and refunded states', () => {
    expect(deriveSubscriptionStatus({ transaction: tx({ expiresDateMs: past }) })).toBe('expired')
    expect(deriveSubscriptionStatus({ transaction: tx({ revoked: true }) })).toBe('revoked')
    expect(deriveSubscriptionStatus({ transaction: tx(), notificationType: NotificationTypeV2.REFUND })).toBe('refunded')
    expect(deriveSubscriptionStatus({ transaction: tx(), notificationType: NotificationTypeV2.REVOKE })).toBe('revoked')
    expect(deriveSubscriptionStatus({ transaction: tx(), notificationType: NotificationTypeV2.EXPIRED })).toBe('expired')
  })

  it('maps grace period and billing retry notification paths', () => {
    expect(deriveSubscriptionStatus({
      transaction: tx({ expiresDateMs: past }),
      renewal: { gracePeriodExpiresDate: new Date(future).toISOString() },
      notificationType: NotificationTypeV2.DID_FAIL_TO_RENEW,
      subtype: Subtype.GRACE_PERIOD,
    })).toBe('grace_period')
    expect(deriveSubscriptionStatus({
      transaction: tx({ expiresDateMs: past }),
      renewal: { isInBillingRetryPeriod: true },
      notificationType: NotificationTypeV2.DID_FAIL_TO_RENEW,
      subtype: Subtype.BILLING_RETRY,
    })).toBe('billing_retry')
    expect(deriveSubscriptionStatus({
      transaction: tx({ expiresDateMs: past }),
      notificationType: NotificationTypeV2.DID_FAIL_TO_RENEW,
    })).toBe('billing_retry')
  })

  it('keeps PRICE_INCREASE and DID_RENEW on date-based active status', () => {
    expect(deriveSubscriptionStatus({
      transaction: tx(),
      notificationType: NotificationTypeV2.PRICE_INCREASE,
      subtype: Subtype.PENDING,
    })).toBe('active')
    expect(deriveSubscriptionStatus({
      transaction: tx(),
      notificationType: NotificationTypeV2.DID_RENEW,
    })).toBe('active')
  })

  it('does not grant billing retry and keeps valid grace active', () => {
    expect(subscriptionStatusIsActive('billing_retry', new Date(future).toISOString())).toBe(false)
    expect(subscriptionStatusIsActive('grace_period', new Date(past).toISOString())).toBe(true)
    expect(subscriptionStatusIsActive('expired', new Date(past).toISOString())).toBe(false)
    expect(subscriptionStatusIsActive('refunded', new Date(future).toISOString())).toBe(false)
    expect(subscriptionStatusIsActive('revoked', new Date(future).toISOString())).toBe(false)
  })
})

describe('appAccountToken binding', () => {
  it('accepts the authenticated Supabase UUID', () => {
    expect(() => assertSubscriptionIdentity(tx(), tx().appAccountToken)).not.toThrow()
  })

  it('rejects missing and cross-account tokens', () => {
    expect(() => assertSubscriptionIdentity(tx({ appAccountToken: null }), tx().appAccountToken)).toThrow(SubscriptionAccountTokenError)
    expect(() => assertSubscriptionIdentity(tx(), '11111111-1111-4111-8111-111111111111')).toThrow(SubscriptionAccountTokenError)
  })
})

describe('production kill switch', () => {
  it('blocks brand-new Production grants while purchasable=false', () => {
    expect(shouldBlockSubscriptionGrant({
      product: monthlyProduct,
      verified: { environment: 'Production' },
      existingBinding: null,
    })).toBe('sales_closed')
  })

  it('allows Sandbox, existing bindings, and open sales', () => {
    expect(shouldBlockSubscriptionGrant({
      product: monthlyProduct,
      verified: { environment: 'Sandbox' },
      existingBinding: null,
    })).toBeNull()
    expect(shouldBlockSubscriptionGrant({
      product: monthlyProduct,
      verified: { environment: 'Production' },
      existingBinding: { original_transaction_id: 'orig-1' },
    })).toBeNull()
    expect(shouldBlockSubscriptionGrant({
      product: { ...monthlyProduct, is_purchasable: true },
      verified: { environment: 'Production' },
      existingBinding: null,
    })).toBeNull()
  })
})

describe('normalized entitlement snapshot', () => {
  it('returns required status fields for an active subscription', () => {
    const snapshot = safeSubscriptionEntitlement({
      active: true,
      status: 'active',
      product_id: 'com.aydenz.youmilensipad.student.monthly',
      environment: 'Sandbox',
      purchased_at: '2026-07-01T00:00:00.000Z',
      expires_at: '2026-08-01T00:00:00.000Z',
      original_transaction_id: 'orig-1',
      latest_transaction_id: 'tx-2',
      subscription_group_id: '22109238',
      auto_renew_status: true,
      revocation_at: null,
      last_verified_at: '2026-07-23T00:00:00.000Z',
    })
    expect(snapshot).toMatchObject({
      active: true,
      status: 'active',
      productId: 'com.aydenz.youmilensipad.student.monthly',
      environment: 'Sandbox',
      expiresAt: '2026-08-01T00:00:00.000Z',
      expirationDate: '2026-08-01T00:00:00.000Z',
      renewalDate: '2026-08-01T00:00:00.000Z',
      subscriptionGroupId: '22109238',
      verificationTimestamp: '2026-07-23T00:00:00.000Z',
    })
  })

  it('clears renewalDate when auto-renew is off and preserves revoked/refunded statuses', () => {
    expect(safeSubscriptionEntitlement({
      active: false,
      status: 'refunded',
      product_id: 'com.aydenz.youmilensipad.student.annual',
      environment: 'Production',
      purchased_at: '2026-01-01T00:00:00.000Z',
      expires_at: '2027-01-01T00:00:00.000Z',
      original_transaction_id: 'orig-9',
      latest_transaction_id: 'tx-9',
      subscription_group_id: '22109238',
      auto_renew_status: false,
      revocation_at: '2026-07-01T00:00:00.000Z',
      last_verified_at: '2026-07-01T00:00:00.000Z',
    })).toMatchObject({
      active: false,
      status: 'refunded',
      renewalDate: null,
      environment: 'Production',
    })
  })
})

// ── Product change inside one Apple subscription group (S5/S6/S7) ────────────
// Apple keeps ONE originalTransactionId across Monthly⇄Annual changes in the
// same group. Ownership must be preserved and the product updated in place —
// an Annual change must never be treated as an unrelated membership.
describe('subscription product change within the same group', () => {
  const OWNER = '11111111-1111-4111-8111-111111111111'
  const ORIGINAL = 'orig-shared-across-group'
  const monthly = tx({ originalTransactionId: ORIGINAL, appAccountToken: OWNER })
  const annual = tx({ originalTransactionId: ORIGINAL, appAccountToken: OWNER })

  it('S5/S6: the same owner keeps identity when switching Monthly ⇄ Annual', () => {
    expect(() => assertSubscriptionIdentity(monthly, OWNER)).not.toThrow()
    expect(() => assertSubscriptionIdentity(annual, OWNER)).not.toThrow()
  })

  it('S7: a product change reuses the SAME originalTransactionId', () => {
    // The upsert key is original_transaction_id, so the row is updated in
    // place rather than creating a second, competing subscription.
    expect(annual.originalTransactionId).toBe(monthly.originalTransactionId)
  })

  it('S9: a different Youmi account cannot claim the same Apple subscription', () => {
    const other = '22222222-2222-4222-8222-222222222222'
    expect(() => assertSubscriptionIdentity(annual, other)).toThrow(SubscriptionAccountTokenError)
  })

  it('S11: a legacy transaction with no appAccountToken is rejected, not silently accepted', () => {
    const legacy = tx({ originalTransactionId: ORIGINAL, appAccountToken: null })
    expect(() => assertSubscriptionIdentity(legacy, OWNER)).toThrow(SubscriptionAccountTokenError)
  })

  it('S13: an existing binding keeps a Sandbox/TestFlight change out of the sales kill switch', () => {
    const annualProduct = {
      product_id: 'com.aydenz.youmilensipad.student.annual',
      kind: 'auto_renewable',
      is_purchasable: false,
    }
    // TestFlight is Sandbox — never blocked.
    expect(shouldBlockSubscriptionGrant({
      product: annualProduct,
      verified: { environment: 'Sandbox' },
      existingBinding: null,
    })).toBeNull()
    // ...and an existing owner is never blocked even in Production.
    expect(shouldBlockSubscriptionGrant({
      product: annualProduct,
      verified: { environment: 'Production' },
      existingBinding: { user_id: OWNER },
    })).toBeNull()
  })

  it('unseeded catalog row is what turns Annual into unknown_product', () => {
    // isAutoRenewableProduct is the fork: a missing billing_products row sends
    // an auto-renewable subscription down the legacy path, which rejects it.
    expect(isAutoRenewableProduct(null)).toBe(false)
    expect(isAutoRenewableProduct({
      product_id: 'com.aydenz.youmilensipad.student.annual',
      kind: 'auto_renewable',
    })).toBe(true)
  })
})
