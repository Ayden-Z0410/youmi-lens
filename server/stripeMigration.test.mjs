import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const migration = readFileSync(
  new URL('../supabase-migration-stripe-desktop-subscriptions.sql', import.meta.url),
  'utf8',
)

describe('Stripe subscription migration access controls', () => {
  it('keeps customer mappings and webhook events service-role only', () => {
    for (const table of ['stripe_customers', 'stripe_webhook_events']) {
      expect(migration).toContain(
        `REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated;`,
      )
      expect(migration).toContain(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.${table} TO service_role;`,
      )
    }
  })

  it('allows read-own subscription access without client writes', () => {
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.subscriptions FROM PUBLIC, anon, authenticated;',
    )
    expect(migration).toContain(
      'GRANT SELECT ON TABLE public.subscriptions TO authenticated;',
    )
    expect(migration).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.subscriptions TO service_role;',
    )
    expect(migration).toContain('USING ((select auth.uid()) = user_id);')
  })

  it('keeps entitlement projection callable only by the service role', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.project_stripe_entitlement[\s\S]*FROM PUBLIC, anon, authenticated;/,
    )
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.project_stripe_entitlement[\s\S]*TO service_role;/,
    )
  })
})

describe('Stripe subscription migration production compatibility', () => {
  it('preserves every existing billing kind while adding renewing', () => {
    const match = migration.match(
      /ADD CONSTRAINT billing_products_kind_check\s+CHECK \(kind IN \(([^)]+)\)\);/,
    )
    expect(match).not.toBeNull()
    const values = [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1])
    expect(values).toEqual([
      'non_renewing',
      'consumable',
      'auto_renewable',
      'renewing',
    ])
  })

  it('preserves existing subscription events and adds only the required Stripe events', () => {
    const match = migration.match(
      /ADD CONSTRAINT billing_events_event_type_check\s+CHECK \(event_type IN \(([\s\S]*?)\)\);/,
    )
    expect(match).not.toBeNull()
    const values = [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1])
    expect(values).toEqual([
      'verify_ok',
      'verify_reject',
      'grant',
      'restore',
      'refund',
      'revoke',
      'notification',
      'sales_cutoff_block',
      'kill_switch_block',
      'subscription_started',
      'subscription_renewed',
      'subscription_status_changed',
      'subscription_reconciled',
      'stripe_checkout_completed',
      'stripe_subscription_created',
      'stripe_subscription_updated',
      'stripe_subscription_deleted',
      'stripe_renewal',
      'stripe_payment_failed',
      'stripe_webhook_error',
    ])
  })

  it('does not rewrite existing iPad products or name any App Store product id', () => {
    expect(migration).not.toMatch(/UPDATE\s+public\.billing_products/i)
    expect(migration).not.toContain('com.aydenz.youmilensipad')
    expect(migration).toContain("('student_basic_monthly', 'stripe'")
    expect(migration).toContain("('student_basic_annual',  'stripe'")
  })
})
