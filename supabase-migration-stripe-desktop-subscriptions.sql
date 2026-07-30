-- ============================================================================
-- Youmi Lens — Commercialization V2 · Phase 1A
-- Desktop Stripe Subscription Foundation (ADDITIVE ONLY).
--
-- This migration is DESKTOP-ONLY (Website + Mac + Windows). It adds a Stripe
-- subscription rail alongside the existing Apple IAP rail. It NEVER modifies,
-- reactivates, or deletes any Apple product, transaction, or entitlement, and
-- it does not touch quota values.
--
-- Design contract (unchanged engine reused):
--   • public.user_entitlements stays the source of truth for "access right now".
--   • public.subscriptions is the canonical Stripe BILLING LIFECYCLE record and
--     is NEVER read as the quota gate directly.
--   • A valid Stripe subscription PROJECTS into ONE student_pass entitlement.
--   • Both monthly and annual map to plan_type = 'student_pass' (no new tier).
--
-- Every statement is guarded (IF NOT EXISTS / idempotent) so the file is
-- re-runnable. Run in a coordinated deploy with the Phase 1A backend.
-- ============================================================================

-- Shared updated_at trigger (already exists in prod; redefined idempotently).
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 1. stripe_customers — one Supabase user ↔ one Stripe customer.
--    The Stripe customer id is NEVER supplied by the client; the server maps it
--    here and reuses it for returning users. UNIQUE on both columns prevents a
--    duplicate customer per account and a customer shared across accounts.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stripe_customers (
  user_id            uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id text        NOT NULL UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS stripe_customers_updated_at ON public.stripe_customers;
CREATE TRIGGER stripe_customers_updated_at
  BEFORE UPDATE ON public.stripe_customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.stripe_customers ENABLE ROW LEVEL SECURITY;
-- No client policies: server (service role) reads/writes only. The mapping is
-- never trusted from, nor exposed to, the client.
REVOKE ALL ON TABLE public.stripe_customers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stripe_customers TO service_role;

-- ----------------------------------------------------------------------------
-- 2. subscriptions — canonical Stripe billing lifecycle (extensible provider).
--    This records renewal state; it is NOT the access gate. current_period_end
--    and grace_until bound the projected entitlement window.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider                 text        NOT NULL DEFAULT 'stripe',
  provider_subscription_id text        NOT NULL,
  plan_code                text        NOT NULL,   -- student_basic_monthly | student_basic_annual
  status                   text        NOT NULL,
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean     NOT NULL DEFAULT false,
  grace_until              timestamptz,
  provider_price_id        text,
  -- Stripe event `created` time of the last applied webhook. Used to reject
  -- out-of-order (stale) deliveries so a newer period/status is never regressed.
  last_event_at            timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  -- Provider set is intentionally 'stripe' only for this Desktop phase. Widen
  -- (do not replace) in a future phase if another provider is ever added here.
  CONSTRAINT subscriptions_provider_check
    CHECK (provider IN ('stripe')),
  CONSTRAINT subscriptions_status_check
    CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  CONSTRAINT subscriptions_provider_sub_unique
    UNIQUE (provider, provider_subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id
  ON public.subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status
  ON public.subscriptions (status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_current_period_end
  ON public.subscriptions (current_period_end);

-- Idempotent add for re-runs where an earlier version created the table without
-- the ordering marker.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS last_event_at timestamptz;

DROP TRIGGER IF EXISTS subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subscriptions_select_own" ON public.subscriptions;
CREATE POLICY "subscriptions_select_own"
  ON public.subscriptions FOR SELECT
  USING ((select auth.uid()) = user_id);
-- No INSERT/UPDATE/DELETE policies: service role only.
REVOKE ALL ON TABLE public.subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.subscriptions TO service_role;

-- ----------------------------------------------------------------------------
-- 3. stripe_webhook_events — at-least-once delivery idempotency ledger.
--    Mirrors the discipline of public.apple_iap_notifications. Stores only
--    operational metadata (never the raw payload / card / PII).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id          text        PRIMARY KEY,
  event_type        text,
  processing_status text        NOT NULL DEFAULT 'processing',
  safe_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT stripe_webhook_events_processing_status_check
    CHECK (processing_status IN ('processing', 'processed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_type_created
  ON public.stripe_webhook_events (event_type, created_at);

DROP TRIGGER IF EXISTS stripe_webhook_events_updated_at ON public.stripe_webhook_events;
CREATE TRIGGER stripe_webhook_events_updated_at
  BEFORE UPDATE ON public.stripe_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
-- No policies: Stripe webhook metadata is backend service-role only.
REVOKE ALL ON TABLE public.stripe_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stripe_webhook_events TO service_role;

-- ----------------------------------------------------------------------------
-- 4. user_entitlements — make the entitlement source PROVIDER-NEUTRAL.
--    Apple rows keep source_transaction_id (FK preserved, still enforced on
--    non-null values). Stripe rows use (provider='stripe', provider_ref=<sub id>)
--    and leave source_transaction_id NULL. Nothing about the Apple path changes.
-- ----------------------------------------------------------------------------

-- 4a. provider column (defaults 'apple' so every existing row is unchanged).
ALTER TABLE public.user_entitlements
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'apple';
ALTER TABLE public.user_entitlements
  DROP CONSTRAINT IF EXISTS user_entitlements_provider_check;
ALTER TABLE public.user_entitlements
  ADD CONSTRAINT user_entitlements_provider_check
  CHECK (provider IN ('apple', 'stripe'));

-- 4b. provider_ref — the non-Apple source key (Stripe subscription id).
ALTER TABLE public.user_entitlements
  ADD COLUMN IF NOT EXISTS provider_ref text;

-- 4c. Relax source_transaction_id to NULLable so Stripe grants need no fake
--     Apple transaction. The FK stays (NULLs are exempt); Apple rows unchanged.
ALTER TABLE public.user_entitlements
  ALTER COLUMN source_transaction_id DROP NOT NULL;

-- 4d. Integrity: exactly one valid source per row. Existing Apple rows already
--     satisfy the apple branch (provider defaults 'apple', txn id present).
ALTER TABLE public.user_entitlements
  DROP CONSTRAINT IF EXISTS user_entitlements_source_present_check;
ALTER TABLE public.user_entitlements
  ADD CONSTRAINT user_entitlements_source_present_check
  CHECK (
    (provider = 'apple'  AND source_transaction_id IS NOT NULL) OR
    (provider = 'stripe' AND provider_ref IS NOT NULL AND char_length(btrim(provider_ref)) > 0)
  );

-- 4e. Stripe idempotency: one entitlement row per Stripe subscription. Partial
--     unique index leaves Apple rows (provider_ref NULL) untouched.
--     NOTE: the predicate is EXACTLY `provider = 'stripe'` so it matches the
--     `ON CONFLICT (provider, provider_ref) WHERE provider = 'stripe'` arbiter in
--     project_stripe_entitlement (Postgres requires the index predicate to be
--     implied by the ON CONFLICT predicate for inference to succeed). The
--     source-present CHECK above already forbids a NULL/blank Stripe provider_ref.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_entitlements_stripe_provider_ref
  ON public.user_entitlements (provider, provider_ref)
  WHERE provider = 'stripe';

-- ----------------------------------------------------------------------------
-- 5. billing_products — represent Desktop Stripe products (extend, don't replace).
--    Apple rows are untouched (provider defaults 'apple').
-- ----------------------------------------------------------------------------
ALTER TABLE public.billing_products
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'apple';
ALTER TABLE public.billing_products
  DROP CONSTRAINT IF EXISTS billing_products_provider_check;
ALTER TABLE public.billing_products
  ADD CONSTRAINT billing_products_provider_check
  CHECK (provider IN ('apple', 'stripe'));

ALTER TABLE public.billing_products
  ADD COLUMN IF NOT EXISTS provider_product_id text;
ALTER TABLE public.billing_products
  ADD COLUMN IF NOT EXISTS provider_price_id text;
ALTER TABLE public.billing_products
  ADD COLUMN IF NOT EXISTS billing_interval text;

ALTER TABLE public.billing_products
  DROP CONSTRAINT IF EXISTS billing_products_billing_interval_check;
ALTER TABLE public.billing_products
  ADD CONSTRAINT billing_products_billing_interval_check
  CHECK (billing_interval IS NULL OR billing_interval IN ('month', 'year'));

-- Allow the Stripe 'renewing' kind alongside the existing Apple kinds.
ALTER TABLE public.billing_products
  DROP CONSTRAINT IF EXISTS billing_products_kind_check;
ALTER TABLE public.billing_products
  ADD CONSTRAINT billing_products_kind_check
  CHECK (kind IN ('non_renewing', 'consumable', 'auto_renewable', 'renewing'));

-- Seed the two Desktop Stripe plan rows (student_pass tier, monthly + annual).
-- provider_price_id is a PLACEHOLDER — the server resolves the trusted price id
-- from environment config (STRIPE_PRICE_*). Update these after the real Stripe
-- prices exist. is_purchasable=false keeps them dormant until wired in Phase 1B.
INSERT INTO public.billing_products
  (product_id, provider, plan_type, kind, entitlement_days, display_name,
   is_purchasable, provider_product_id, provider_price_id, billing_interval)
VALUES
  ('student_basic_monthly', 'stripe', 'student_pass', 'renewing', 30,
   'Student Basic (Monthly)', false, NULL, 'price_REPLACE_ME_MONTHLY', 'month'),
  ('student_basic_annual',  'stripe', 'student_pass', 'renewing', 365,
   'Student Basic (Annual)',  false, NULL, 'price_REPLACE_ME_ANNUAL',  'year')
ON CONFLICT (product_id) DO UPDATE SET
  provider            = EXCLUDED.provider,
  plan_type           = EXCLUDED.plan_type,
  kind                = EXCLUDED.kind,
  entitlement_days    = EXCLUDED.entitlement_days,
  display_name        = EXCLUDED.display_name,
  billing_interval    = EXCLUDED.billing_interval,
  updated_at          = now();
-- NOTE: DO UPDATE intentionally does NOT overwrite is_purchasable or
-- provider_price_id, so a later manual configuration of the real price ids and
-- purchasable flag is not clobbered by a re-run of this migration.

-- ----------------------------------------------------------------------------
-- 6. billing_events — one audit trail for both rails. Add Stripe verbs.
-- ----------------------------------------------------------------------------
ALTER TABLE public.billing_events
  DROP CONSTRAINT IF EXISTS billing_events_event_type_check;
ALTER TABLE public.billing_events
  ADD CONSTRAINT billing_events_event_type_check
  CHECK (event_type IN (
    -- existing Apple / shared verbs (unchanged)
    'verify_ok', 'verify_reject', 'grant', 'restore', 'refund', 'revoke',
    'notification', 'sales_cutoff_block', 'kill_switch_block',
    'subscription_started', 'subscription_renewed',
    'subscription_status_changed', 'subscription_reconciled',
    -- new Stripe (Desktop) verbs
    'stripe_checkout_completed', 'stripe_subscription_created',
    'stripe_subscription_updated', 'stripe_subscription_deleted',
    'stripe_renewal', 'stripe_payment_failed', 'stripe_webhook_error'
  ));

-- ----------------------------------------------------------------------------
-- 7. project_stripe_entitlement — atomic, idempotent projection of a Stripe
--    subscription period into ONE student_pass user_entitlement.
--
--    p_active = true  → active grant, window [p_starts_at, p_expires_at).
--    p_active = false → revoked row (no access); still idempotent by sub id.
--
--    Keyed by (provider='stripe', provider_ref=subscription_id) so the SAME
--    subscription can never create two rows — a renewal just extends the window.
--    Quota is per user_id, so even multiple rows could never multiply quota;
--    this keeps it to exactly one row per subscription regardless.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.project_stripe_entitlement(
  p_user_id         uuid,
  p_subscription_id text,
  p_product_id      text,
  p_starts_at       timestamptz,
  p_expires_at      timestamptz,
  p_active          boolean
)
RETURNS public.user_entitlements
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_entitlement public.user_entitlements%ROWTYPE;
  v_starts  timestamptz := coalesce(p_starts_at, now());
  v_expires timestamptz := coalesce(p_expires_at, now());
BEGIN
  -- Defensive per-user serialization (matches the consumable path discipline).
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  INSERT INTO public.user_entitlements (
    user_id, product_id, plan_type, provider, provider_ref,
    source_transaction_id, starts_at, expires_at, status, revoked_at
  )
  VALUES (
    p_user_id, p_product_id, 'student_pass', 'stripe', p_subscription_id,
    NULL, v_starts, v_expires,
    CASE WHEN p_active THEN 'active' ELSE 'revoked' END,
    CASE WHEN p_active THEN NULL ELSE now() END
  )
  ON CONFLICT (provider, provider_ref) WHERE provider = 'stripe'
  DO UPDATE SET
    product_id = EXCLUDED.product_id,
    starts_at  = EXCLUDED.starts_at,
    expires_at = EXCLUDED.expires_at,
    status     = EXCLUDED.status,
    revoked_at = EXCLUDED.revoked_at,
    updated_at = now()
  RETURNING * INTO v_entitlement;

  RETURN v_entitlement;
END;
$$;

REVOKE ALL ON FUNCTION public.project_stripe_entitlement(uuid, text, text, timestamptz, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_stripe_entitlement(uuid, text, text, timestamptz, timestamptz, boolean)
  TO service_role;

-- ============================================================================
-- VALIDATION QUERIES (run manually AFTER applying; commented out of the txn).
-- ============================================================================
-- SELECT to_regclass('public.stripe_customers'), to_regclass('public.subscriptions'),
--        to_regclass('public.stripe_webhook_events');
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='user_entitlements'
--     AND column_name IN ('provider','provider_ref') ORDER BY column_name;
-- SELECT is_nullable FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='user_entitlements'
--     AND column_name='source_transaction_id';   -- expect YES
-- SELECT indexname FROM pg_indexes
--   WHERE tablename='user_entitlements' AND indexname='uq_user_entitlements_stripe_provider_ref';
-- SELECT product_id, provider, billing_interval, plan_type FROM public.billing_products
--   WHERE provider='stripe' ORDER BY product_id;
-- ============================================================================

-- ROLLBACK IMPLICATIONS
-- ---------------------
-- This migration is additive, but reversing it after Stripe writes begin is not
-- a simple DROP: first stop Stripe webhook/refresh writes and export the Stripe
-- lifecycle + entitlement rows. Stripe entitlements must be removed or archived
-- before source_transaction_id can safely become NOT NULL again. Only then may
-- the projection function, Stripe tables/index, provider-neutral columns, and
-- widened CHECK constraints be removed. Never roll back by deleting or rewriting
-- existing Apple transaction-backed entitlement rows.
