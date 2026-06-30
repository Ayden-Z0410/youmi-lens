-- ============================================================================
-- Make the live Student Basic product purchasable.
--
-- supabase-migration-student-basic-consumable.sql seeds
-- com.aydenz.youmilensipad.studentbasic30d with is_purchasable = false. That
-- hides the purchase entry in the app (betaUsageStatus reads is_purchasable to
-- decide whether to surface the buy button). Student Basic is the live product,
-- so it must be purchasable.
--
-- Run this AFTER supabase-migration-student-basic-consumable.sql. Idempotent.
-- Does NOT change product id, plan, kind, entitlement_days, or price.
-- ============================================================================
UPDATE public.billing_products
   SET is_purchasable = true,
       sales_end_at   = NULL,
       updated_at     = now()
 WHERE product_id = 'com.aydenz.youmilensipad.studentbasic30d';

-- Validation (run manually after applying):
-- SELECT product_id, plan_type, kind, entitlement_days, is_purchasable, sales_end_at
--   FROM public.billing_products
--  WHERE product_id = 'com.aydenz.youmilensipad.studentbasic30d';
-- Expect: is_purchasable = true, kind = consumable, entitlement_days = 30.
