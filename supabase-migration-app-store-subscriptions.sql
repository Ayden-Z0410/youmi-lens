-- Youmi Lens Phase 2 IAP verification foundation.
-- Adds paid iPad plan types and a server-written App Store subscription ledger.

ALTER TABLE public.user_quota
  DROP CONSTRAINT IF EXISTS user_quota_plan_type_check;

ALTER TABLE public.user_quota
  ADD CONSTRAINT user_quota_plan_type_check
  CHECK (plan_type IN (
    'public_trial',
    'core_tester',
    'student_basic',
    'student_plus',
    'student_pro',
    'admin'
  ));

CREATE TABLE IF NOT EXISTS public.app_store_subscriptions (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id              text        NOT NULL,
  plan_type               text        NOT NULL,
  transaction_id          text        UNIQUE,
  original_transaction_id text,
  environment             text,
  status                  text        NOT NULL DEFAULT 'active',
  expires_at              timestamptz,
  revoked_at              timestamptz,
  auto_renew_status       text,
  raw_transaction         jsonb,
  raw_renewal_info        jsonb,
  last_verified_at        timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT app_store_subscriptions_plan_type_check
    CHECK (plan_type IN ('student_basic', 'student_plus', 'student_pro')),
  CONSTRAINT app_store_subscriptions_status_check
    CHECK (status IN ('active', 'expired', 'revoked'))
);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_store_subscriptions_updated_at ON public.app_store_subscriptions;
CREATE TRIGGER app_store_subscriptions_updated_at
  BEFORE UPDATE ON public.app_store_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_app_store_subscriptions_user_id
  ON public.app_store_subscriptions (user_id);

CREATE INDEX IF NOT EXISTS idx_app_store_subscriptions_original_transaction_id
  ON public.app_store_subscriptions (original_transaction_id);

CREATE INDEX IF NOT EXISTS idx_app_store_subscriptions_product_id
  ON public.app_store_subscriptions (product_id);

CREATE INDEX IF NOT EXISTS idx_app_store_subscriptions_status
  ON public.app_store_subscriptions (status);

CREATE INDEX IF NOT EXISTS idx_app_store_subscriptions_expires_at
  ON public.app_store_subscriptions (expires_at);

ALTER TABLE public.app_store_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_store_subscriptions_select_own" ON public.app_store_subscriptions;
CREATE POLICY "app_store_subscriptions_select_own"
  ON public.app_store_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies: client apps may read their own subscription
-- rows, but only the backend service role may create or mutate entitlement data.
