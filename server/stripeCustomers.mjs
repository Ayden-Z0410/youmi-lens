/**
 * Supabase user ↔ Stripe customer mapping (Desktop billing).
 *
 * One user_id → one Stripe customer, reused for returning users. The Stripe
 * customer id is NEVER accepted from the client. Concurrency is guarded by the
 * UNIQUE(user_id) constraint on stripe_customers + an ON CONFLICT DO NOTHING
 * insert, so a race resolves to a single authoritative mapping.
 */

/** Read the stored Stripe customer id for a user, or null. */
export async function getStripeCustomerId(db, userId) {
  const { data, error } = await db
    .from('stripe_customers')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data?.stripe_customer_id ?? null
}

/** Persist a mapping if absent; returns the authoritative stored id. */
export async function linkStripeCustomer(db, userId, stripeCustomerId) {
  const { error } = await db
    .from('stripe_customers')
    .upsert({ user_id: userId, stripe_customer_id: stripeCustomerId }, {
      onConflict: 'user_id',
      ignoreDuplicates: true,
    })
  if (error) throw error
  // Re-read so a concurrent insert's winner is what we return (never trust the
  // just-created id blindly).
  return (await getStripeCustomerId(db, userId)) ?? stripeCustomerId
}

/**
 * Get-or-create the Stripe customer for a user.
 *   db     — service-role Supabase client
 *   stripe — configured Stripe client
 *   user   — { userId, email }
 * On a lost create-race a duplicate Stripe customer may be orphaned in Stripe
 * (never referenced by our DB); acceptable and documented for this phase.
 */
export async function getOrCreateStripeCustomer(db, stripe, { userId, email }) {
  const existing = await getStripeCustomerId(db, userId)
  if (existing) return existing

  const customer = await stripe.customers.create({
    email: email || undefined,
    metadata: { user_id: userId },
  })
  return linkStripeCustomer(db, userId, customer.id)
}
