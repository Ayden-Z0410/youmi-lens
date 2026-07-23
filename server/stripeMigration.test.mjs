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
