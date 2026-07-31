BEGIN;

CREATE OR REPLACE FUNCTION public.revoke_iap_entitlement_by_transaction(
  p_transaction_id text,
  p_revoked_at timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_entitlement public.user_entitlements%ROWTYPE;
  v_transaction public.apple_iap_transactions%ROWTYPE;
  v_user_id uuid;
  v_current_expiry timestamptz;
  v_new_expires_at timestamptz;
  v_row record;
BEGIN
  SELECT *
    INTO v_entitlement
    FROM public.user_entitlements
   WHERE source_transaction_id = p_transaction_id;

  SELECT *
    INTO v_transaction
    FROM public.apple_iap_transactions
   WHERE transaction_id = p_transaction_id;

  v_user_id := coalesce(v_entitlement.user_id, v_transaction.user_id);

  IF v_user_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_user_id::text, 0)
    );
  END IF;

  UPDATE public.user_entitlements
     SET status = 'revoked',
         revoked_at = p_revoked_at
   WHERE source_transaction_id = p_transaction_id;

  UPDATE public.apple_iap_transactions
     SET status = 'revoked',
         revoked_at = p_revoked_at,
         last_verified_at = now()
   WHERE transaction_id = p_transaction_id;

  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_row IN
    SELECT e.id,
           e.starts_at,
           p.entitlement_days
      FROM public.user_entitlements e
      JOIN public.billing_products p
        ON p.product_id = e.product_id
     WHERE e.user_id = v_user_id
       AND e.plan_type = 'student_pass'
       AND e.status = 'active'
       AND e.revoked_at IS NULL
       AND p.kind = 'consumable'
     ORDER BY e.starts_at ASC, e.created_at ASC, e.id ASC
  LOOP
    v_new_expires_at := greatest(
      v_row.starts_at,
      coalesce(v_current_expiry, v_row.starts_at)
    ) + pg_catalog.make_interval(days => v_row.entitlement_days);

    UPDATE public.user_entitlements
       SET expires_at = v_new_expires_at
     WHERE id = v_row.id;

    v_current_expiry := v_new_expires_at;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_iap_entitlement_by_transaction(text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_iap_entitlement_by_transaction(text, timestamptz)
  TO service_role;

COMMIT;
