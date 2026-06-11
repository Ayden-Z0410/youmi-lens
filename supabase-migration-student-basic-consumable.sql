BEGIN;

ALTER TABLE public.billing_products
  DROP CONSTRAINT IF EXISTS billing_products_kind_check;
ALTER TABLE public.billing_products
  ADD CONSTRAINT billing_products_kind_check
  CHECK (kind IN ('non_renewing', 'consumable'));

UPDATE public.billing_products
   SET is_purchasable = false,
       updated_at = now()
 WHERE product_id = 'com.aydenz.youmilensipad.studentpass30d';

INSERT INTO public.billing_products
  (product_id, plan_type, kind, entitlement_days, display_name, is_purchasable, sales_end_at)
VALUES
  ('com.aydenz.youmilensipad.studentbasic30d',
   'student_pass',
   'consumable',
   30,
   'Student Basic – 30 Days',
   false,
   NULL)
ON CONFLICT (product_id) DO UPDATE SET
  plan_type        = EXCLUDED.plan_type,
  kind             = EXCLUDED.kind,
  entitlement_days = EXCLUDED.entitlement_days,
  display_name     = EXCLUDED.display_name,
  is_purchasable   = false,
  sales_end_at     = EXCLUDED.sales_end_at,
  updated_at       = now();

CREATE OR REPLACE FUNCTION public.grant_consumable_entitlement(
  p_user_id uuid,
  p_product_id text,
  p_source_transaction_id text,
  p_purchase_date timestamptz
)
RETURNS public.user_entitlements
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_product public.billing_products%ROWTYPE;
  v_transaction public.apple_iap_transactions%ROWTYPE;
  v_entitlement public.user_entitlements%ROWTYPE;
  v_current_expiry timestamptz;
  v_extension_base timestamptz;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  SELECT *
    INTO v_entitlement
    FROM public.user_entitlements
   WHERE source_transaction_id = p_source_transaction_id;

  IF FOUND THEN
    IF v_entitlement.user_id <> p_user_id THEN
      RAISE EXCEPTION 'transaction entitlement belongs to another account';
    END IF;
    RETURN v_entitlement;
  END IF;

  SELECT *
    INTO v_product
    FROM public.billing_products
   WHERE product_id = p_product_id;

  IF NOT FOUND OR v_product.kind <> 'consumable' OR v_product.plan_type <> 'student_pass' THEN
    RAISE EXCEPTION 'product is not a supported consumable entitlement';
  END IF;

  SELECT *
    INTO v_transaction
    FROM public.apple_iap_transactions
   WHERE transaction_id = p_source_transaction_id;

  IF NOT FOUND
     OR v_transaction.user_id <> p_user_id
     OR v_transaction.product_id <> p_product_id
     OR v_transaction.owner_state <> 'active' THEN
    RAISE EXCEPTION 'verified transaction binding does not match entitlement';
  END IF;

  SELECT max(expires_at)
    INTO v_current_expiry
    FROM public.user_entitlements
   WHERE user_id = p_user_id
     AND plan_type = 'student_pass'
     AND status = 'active'
     AND revoked_at IS NULL;

  v_extension_base := greatest(
    p_purchase_date,
    coalesce(v_current_expiry, p_purchase_date)
  );

  INSERT INTO public.user_entitlements (
    user_id,
    product_id,
    plan_type,
    source_transaction_id,
    starts_at,
    expires_at,
    status,
    revoked_at
  )
  VALUES (
    p_user_id,
    p_product_id,
    v_product.plan_type,
    p_source_transaction_id,
    p_purchase_date,
    v_extension_base + pg_catalog.make_interval(days => v_product.entitlement_days),
    'active',
    NULL
  )
  RETURNING * INTO v_entitlement;

  RETURN v_entitlement;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_consumable_entitlement(uuid, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_consumable_entitlement(uuid, text, text, timestamptz)
  TO service_role;

COMMIT;
