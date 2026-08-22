-- Rollback for Commercialization V2. Refuses to destroy claimed subscription data.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.app_store_subscription_states') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.app_store_subscription_states) THEN
    RAISE EXCEPTION 'Refusing rollback: app_store_subscription_states contains data';
  END IF;
END $$;

DROP TABLE IF EXISTS public.app_store_subscription_states;
DROP TABLE IF EXISTS public.app_store_subscription_bindings;

DELETE FROM public.billing_products
WHERE product_id IN (
  'com.aydenz.youmilensipad.student.monthly',
  'com.aydenz.youmilensipad.student.annual'
);

ALTER TABLE public.billing_products
  DROP CONSTRAINT IF EXISTS billing_products_kind_check;
ALTER TABLE public.billing_products
  DROP CONSTRAINT IF EXISTS billing_products_entitlement_days_check;
ALTER TABLE public.billing_products
  ADD CONSTRAINT billing_products_kind_check
  CHECK (kind IN ('non_renewing', 'consumable'));
ALTER TABLE public.billing_products
  ADD CONSTRAINT billing_products_entitlement_days_check
  CHECK (entitlement_days > 0);
ALTER TABLE public.billing_products
  ALTER COLUMN entitlement_days SET NOT NULL;

ALTER TABLE public.billing_events
  DROP CONSTRAINT IF EXISTS billing_events_event_type_check;
ALTER TABLE public.billing_events
  ADD CONSTRAINT billing_events_event_type_check
  CHECK (event_type IN (
    'verify_ok', 'verify_reject', 'grant', 'restore', 'refund', 'revoke',
    'notification', 'sales_cutoff_block', 'kill_switch_block'
  ));

COMMIT;
