-- Youmi Lens iPad Commercialization V2: auto-renewable subscription state.
-- Additive migration. Legacy Student Pass transactions/entitlements remain intact.

BEGIN;

ALTER TABLE public.billing_products
  DROP CONSTRAINT IF EXISTS billing_products_kind_check;
ALTER TABLE public.billing_products
  ALTER COLUMN entitlement_days DROP NOT NULL;
ALTER TABLE public.billing_products
  ADD CONSTRAINT billing_products_kind_check
  CHECK (kind IN ('non_renewing', 'consumable', 'auto_renewable'));
ALTER TABLE public.billing_products
  DROP CONSTRAINT IF EXISTS billing_products_entitlement_days_check;
ALTER TABLE public.billing_products
  ADD CONSTRAINT billing_products_entitlement_days_check
  CHECK (
    (kind = 'auto_renewable' AND entitlement_days IS NULL)
    OR (kind <> 'auto_renewable' AND entitlement_days > 0)
  );

INSERT INTO public.billing_products (
  product_id, plan_type, kind, entitlement_days, display_name, is_purchasable
) VALUES
  ('com.aydenz.youmilensipad.student.monthly', 'student_pass', 'auto_renewable', NULL, 'Student Access Monthly', false),
  ('com.aydenz.youmilensipad.student.annual', 'student_pass', 'auto_renewable', NULL, 'Student Access Annual', false)
ON CONFLICT (product_id) DO UPDATE SET
  plan_type = EXCLUDED.plan_type,
  kind = EXCLUDED.kind,
  entitlement_days = EXCLUDED.entitlement_days,
  display_name = EXCLUDED.display_name,
  is_purchasable = false,
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.app_store_subscription_bindings (
  original_transaction_id text PRIMARY KEY,
  user_id                 uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  app_account_token       uuid,
  environment             text NOT NULL CHECK (environment IN ('Sandbox', 'Production', 'Xcode', 'LocalTesting')),
  owner_state             text NOT NULL DEFAULT 'active' CHECK (owner_state IN ('active', 'account_deleted')),
  account_deleted_at      timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_store_subscription_binding_owner_check CHECK (
    (owner_state = 'active' AND user_id IS NOT NULL)
    OR owner_state = 'account_deleted'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_binding_app_account_token
  ON public.app_store_subscription_bindings (app_account_token, environment)
  WHERE app_account_token IS NOT NULL AND owner_state = 'active';
CREATE INDEX IF NOT EXISTS idx_subscription_bindings_user
  ON public.app_store_subscription_bindings (user_id);

CREATE TABLE IF NOT EXISTS public.app_store_subscription_states (
  original_transaction_id text PRIMARY KEY
    REFERENCES public.app_store_subscription_bindings(original_transaction_id) ON DELETE RESTRICT,
  user_id                  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id               text NOT NULL,
  latest_transaction_id    text NOT NULL UNIQUE,
  subscription_group_id    text,
  environment              text NOT NULL CHECK (environment IN ('Sandbox', 'Production', 'Xcode', 'LocalTesting')),
  ownership_type           text,
  app_account_token        uuid,
  purchased_at             timestamptz NOT NULL,
  expires_at               timestamptz NOT NULL,
  auto_renew_status        boolean,
  status                   text NOT NULL CHECK (status IN (
    'active',
    'expired',
    'grace_period',
    'billing_retry',
    'revoked',
    'refunded',
    'cancelled_but_active_until_expiry',
    'verification_pending',
    'unknown'
  )),
  revocation_at            timestamptz,
  source                   text NOT NULL DEFAULT 'storekit_jws' CHECK (source IN (
    'storekit_jws', 'app_store_server_api', 'notification_v2', 'reconciliation'
  )),
  last_notification_type   text,
  last_verified_at         timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_states_user
  ON public.app_store_subscription_states (user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_states_status_expiry
  ON public.app_store_subscription_states (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_subscription_states_product
  ON public.app_store_subscription_states (product_id);

DROP TRIGGER IF EXISTS app_store_subscription_bindings_updated_at ON public.app_store_subscription_bindings;
CREATE TRIGGER app_store_subscription_bindings_updated_at
  BEFORE UPDATE ON public.app_store_subscription_bindings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS app_store_subscription_states_updated_at ON public.app_store_subscription_states;
CREATE TRIGGER app_store_subscription_states_updated_at
  BEFORE UPDATE ON public.app_store_subscription_states
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.app_store_subscription_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_store_subscription_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subscription_states_select_own" ON public.app_store_subscription_states;
CREATE POLICY "subscription_states_select_own"
  ON public.app_store_subscription_states FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.app_store_subscription_bindings FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.app_store_subscription_states FROM anon, authenticated;
GRANT SELECT ON public.app_store_subscription_states TO authenticated;

ALTER TABLE public.billing_events
  DROP CONSTRAINT IF EXISTS billing_events_event_type_check;
ALTER TABLE public.billing_events
  ADD CONSTRAINT billing_events_event_type_check
  CHECK (event_type IN (
    'verify_ok', 'verify_reject', 'grant', 'restore', 'refund', 'revoke',
    'notification', 'sales_cutoff_block', 'kill_switch_block',
    'subscription_started', 'subscription_renewed', 'subscription_status_changed',
    'subscription_reconciled'
  ));

COMMIT;
