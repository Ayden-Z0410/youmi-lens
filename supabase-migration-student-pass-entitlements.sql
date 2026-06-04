-- ============================================================================
-- Youmi Lens — Student Pass (Non-Renewing Subscription) — Phase 1 schema.
--
-- Product:        Youmi Lens Student Pass – 30 Days
-- Product ID:     com.aydenz.youmilensipad.studentpass30d
-- Apple type:     Non-Renewing Subscription
-- Entitlement:    exactly 30 days from the Apple-VERIFIED purchaseDate
--                 (server-computed; never trusted from the client, never read
--                 from an Apple `expiresDate` — non-renewing subs carry none).
--
-- SINGLE LEDGER DECISION
-- ----------------------
-- The repo already has ONE verified-transaction table: public.app_store_subscriptions.
-- To avoid two competing ledgers we RENAME it in place to public.apple_iap_transactions
-- (generic Apple IAP ledger). This preserves every historical row, index, RLS
-- policy and the UNIQUE(transaction_id) replay guard with NO data copy and NO
-- dual-write window. After this migration there is exactly one authoritative
-- verified-transaction table and all future routes write only to it.
--
-- DEPLOY ORDERING (manual step — see report)
-- ------------------------------------------
-- Any backend that still references the OLD name "app_store_subscriptions" is
-- incompatible with this migration. Apply this migration only as part of the
-- coordinated Phase 2 backend deploy where all active code paths use
-- "apple_iap_transactions"; do NOT apply it while old code is live.
--
-- This migration is coordinated-deploy safe when run with the Phase 2 backend.
-- It is written to be re-runnable after a successful first run, and includes
-- preflight queries below for production data checks before applying.
-- ============================================================================

-- Shared updated_at trigger function (already exists; redefined idempotently).
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 1. Rename the verified-transaction ledger → apple_iap_transactions
-- ----------------------------------------------------------------------------

-- 1a. Table rename (guarded so re-runs are no-ops).
DO $$
BEGIN
  IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'app_store_subscriptions'
      )
     AND NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'apple_iap_transactions'
      )
  THEN
    ALTER TABLE public.app_store_subscriptions RENAME TO apple_iap_transactions;
  END IF;
END $$;

-- 1b. Clarify expiry semantics: the Apple-supplied expiry (null for non-renewing)
--     is informational only; the authoritative window lives in user_entitlements.
DO $$
BEGIN
  IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'apple_iap_transactions'
          AND column_name = 'expires_at'
      )
     AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'apple_iap_transactions'
          AND column_name = 'apple_expires_date'
      )
  THEN
    ALTER TABLE public.apple_iap_transactions
      RENAME COLUMN expires_at TO apple_expires_date;
  END IF;
END $$;

-- 1c. Verified Apple purchaseDate — REQUIRED to compute the 30-day entitlement
--     window and to enforce the sales cutoff. Nullable so historical rows remain
--     valid; Phase 2 writes it for every new transaction.
ALTER TABLE public.apple_iap_transactions
  ADD COLUMN IF NOT EXISTS purchase_date timestamptz;

-- 1d. Relax the plan_type check to include the new non-renewing pass while
--     keeping the legacy paid tiers so existing rows stay valid.
ALTER TABLE public.apple_iap_transactions
  DROP CONSTRAINT IF EXISTS app_store_subscriptions_plan_type_check;
ALTER TABLE public.apple_iap_transactions
  DROP CONSTRAINT IF EXISTS apple_iap_transactions_plan_type_check;
ALTER TABLE public.apple_iap_transactions
  ADD CONSTRAINT apple_iap_transactions_plan_type_check
  CHECK (plan_type IN ('student_basic', 'student_plus', 'student_pro', 'student_pass'));

-- 1e. status check carries over from the rename; re-assert idempotently.
ALTER TABLE public.apple_iap_transactions
  DROP CONSTRAINT IF EXISTS app_store_subscriptions_status_check;
ALTER TABLE public.apple_iap_transactions
  DROP CONSTRAINT IF EXISTS apple_iap_transactions_status_check;
ALTER TABLE public.apple_iap_transactions
  ADD CONSTRAINT apple_iap_transactions_status_check
  CHECK (status IN ('active', 'expired', 'revoked'));

-- 1f. Preserve Apple transaction audit history through account deletion.
--     The original FK was `user_id NOT NULL REFERENCES auth.users ON DELETE CASCADE`,
--     which would DESTROY the verified-transaction audit trail when an account is
--     deleted. Relax to nullable + ON DELETE SET NULL so the immutable transaction
--     record (and any later refund/revoke reconciliation keyed by transaction_id)
--     survives, while ephemeral user_entitlements still cascade away. After this,
--     accountRoutes.mjs must NOT explicitly delete these rows. RLS keeps the
--     anonymized rows readable by the service role only.
ALTER TABLE public.apple_iap_transactions
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.apple_iap_transactions
  DROP CONSTRAINT IF EXISTS app_store_subscriptions_user_id_fkey;
ALTER TABLE public.apple_iap_transactions
  DROP CONSTRAINT IF EXISTS apple_iap_transactions_user_id_fkey;
ALTER TABLE public.apple_iap_transactions
  ADD CONSTRAINT apple_iap_transactions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 1g. Deleted-account binding protection. A transaction whose Youmi account was
--     deleted remains blocked from automatic claim by any newly-created account.
--     accountRoutes.mjs marks owner_state='account_deleted' before deleting the
--     auth user; the FK then sets user_id NULL while the ledger row survives.
ALTER TABLE public.apple_iap_transactions
  ADD COLUMN IF NOT EXISTS owner_state text NOT NULL DEFAULT 'active';
ALTER TABLE public.apple_iap_transactions
  ADD COLUMN IF NOT EXISTS account_deleted_at timestamptz;
ALTER TABLE public.apple_iap_transactions
  DROP CONSTRAINT IF EXISTS apple_iap_transactions_owner_state_check;
ALTER TABLE public.apple_iap_transactions
  ADD CONSTRAINT apple_iap_transactions_owner_state_check
  CHECK (owner_state IN ('active', 'account_deleted'));

UPDATE public.apple_iap_transactions
   SET owner_state = 'active'
 WHERE owner_state IS NULL;

-- 1h. Rename indexes (drop old-named, create new-named). The UNIQUE(transaction_id)
--     constraint that enforces replay protection is preserved by the table rename
--     and is intentionally left intact.
DROP INDEX IF EXISTS idx_app_store_subscriptions_user_id;
DROP INDEX IF EXISTS idx_app_store_subscriptions_original_transaction_id;
DROP INDEX IF EXISTS idx_app_store_subscriptions_product_id;
DROP INDEX IF EXISTS idx_app_store_subscriptions_status;
DROP INDEX IF EXISTS idx_app_store_subscriptions_expires_at;

CREATE INDEX IF NOT EXISTS idx_apple_iap_transactions_user_id
  ON public.apple_iap_transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_apple_iap_transactions_original_transaction_id
  ON public.apple_iap_transactions (original_transaction_id);
CREATE INDEX IF NOT EXISTS idx_apple_iap_transactions_product_id
  ON public.apple_iap_transactions (product_id);
CREATE INDEX IF NOT EXISTS idx_apple_iap_transactions_status
  ON public.apple_iap_transactions (status);
CREATE INDEX IF NOT EXISTS idx_apple_iap_transactions_purchase_date
  ON public.apple_iap_transactions (purchase_date);
CREATE INDEX IF NOT EXISTS idx_apple_iap_transactions_owner_state
  ON public.apple_iap_transactions (owner_state);

-- 1i. updated_at trigger (drop old/new names, recreate on the renamed table).
DROP TRIGGER IF EXISTS app_store_subscriptions_updated_at ON public.apple_iap_transactions;
DROP TRIGGER IF EXISTS apple_iap_transactions_updated_at ON public.apple_iap_transactions;
CREATE TRIGGER apple_iap_transactions_updated_at
  BEFORE UPDATE ON public.apple_iap_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 1j. RLS: owner may read own rows; only the service role writes entitlement data.
ALTER TABLE public.apple_iap_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app_store_subscriptions_select_own" ON public.apple_iap_transactions;
DROP POLICY IF EXISTS "apple_iap_transactions_select_own" ON public.apple_iap_transactions;
CREATE POLICY "apple_iap_transactions_select_own"
  ON public.apple_iap_transactions FOR SELECT
  USING (auth.uid() = user_id);
-- No INSERT/UPDATE/DELETE policies: service role only.

-- ----------------------------------------------------------------------------
-- 2. billing_products — server-side product config (price-mapping, entitlement
--    duration, purchasable kill switch, sales cutoff). Lets quota/duration/sales
--    change WITHOUT shipping a new app. Server-only (RLS on, no client policy).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_products (
  product_id        text        PRIMARY KEY,
  plan_type         text        NOT NULL,
  kind              text        NOT NULL DEFAULT 'non_renewing',
  entitlement_days  integer     NOT NULL,
  display_name      text        NOT NULL,
  is_purchasable    boolean     NOT NULL DEFAULT true,
  sales_end_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT billing_products_kind_check
    CHECK (kind IN ('non_renewing')),
  CONSTRAINT billing_products_plan_type_check
    CHECK (plan_type IN ('student_pass')),
  CONSTRAINT billing_products_entitlement_days_check
    CHECK (entitlement_days > 0)
);

DROP TRIGGER IF EXISTS billing_products_updated_at ON public.billing_products;
CREATE TRIGGER billing_products_updated_at
  BEFORE UPDATE ON public.billing_products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.billing_products ENABLE ROW LEVEL SECURITY;
-- No policies: configuration is read/written by the backend service role only.
-- (The paywall learns `is_purchasable` via /api/quota/status, not by reading this
-- table directly, and the displayed price always comes from StoreKit.)

-- ----------------------------------------------------------------------------
-- 3. user_entitlements — effective, time-boxed grants. This is the authority for
--    "is the pass active right now". expires_at is SERVER-COMPUTED from the
--    verified purchaseDate + billing_products.entitlement_days. One grant per
--    Apple transaction (UNIQUE source_transaction_id => idempotent grant).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_entitlements (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id            text        NOT NULL,
  plan_type             text        NOT NULL,
  source_transaction_id text        NOT NULL UNIQUE
                          REFERENCES public.apple_iap_transactions(transaction_id) ON DELETE CASCADE,
  starts_at             timestamptz NOT NULL,
  expires_at            timestamptz NOT NULL,
  status                text        NOT NULL DEFAULT 'active',
  revoked_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_entitlements_plan_type_check
    CHECK (plan_type IN ('student_pass')),
  CONSTRAINT user_entitlements_status_check
    CHECK (status IN ('active', 'expired', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_user_entitlements_user_status_expires
  ON public.user_entitlements (user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_user_entitlements_expires_at
  ON public.user_entitlements (expires_at);

DROP TRIGGER IF EXISTS user_entitlements_updated_at ON public.user_entitlements;
CREATE TRIGGER user_entitlements_updated_at
  BEFORE UPDATE ON public.user_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_entitlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_entitlements_select_own" ON public.user_entitlements;
CREATE POLICY "user_entitlements_select_own"
  ON public.user_entitlements FOR SELECT
  USING (auth.uid() = user_id);
-- No INSERT/UPDATE/DELETE policies: service role only.

-- ----------------------------------------------------------------------------
-- 4. billing_events — append-only audit trail. Service role writes; never
--    updated or deleted in normal operation. user_id is SET NULL on account
--    deletion so the audit record survives without dangling FK / PII linkage.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type      text        NOT NULL,
  product_id      text,
  transaction_id  text,
  environment     text,
  detail          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT billing_events_event_type_check
    CHECK (event_type IN (
      'verify_ok',
      'verify_reject',
      'grant',
      'restore',
      'refund',
      'revoke',
      'notification',
      'sales_cutoff_block',
      'kill_switch_block'
    ))
);

CREATE INDEX IF NOT EXISTS idx_billing_events_user_created
  ON public.billing_events (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_billing_events_transaction_id
  ON public.billing_events (transaction_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_type_created
  ON public.billing_events (event_type, created_at);

ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
-- No policies: audit log is service-role only (append-only; not client-readable).

-- ----------------------------------------------------------------------------
-- 5. apple_iap_notifications — race-safe App Store Server Notification V2
--    idempotency ledger. We store only operational metadata, never signedPayload.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.apple_iap_notifications (
  notification_uuid text        PRIMARY KEY,
  notification_type text,
  subtype           text,
  environment       text,
  transaction_id    text,
  processing_status text        NOT NULL DEFAULT 'processing',
  processed_at      timestamptz,
  safe_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT apple_iap_notifications_processing_status_check
    CHECK (processing_status IN ('processing', 'processed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_apple_iap_notifications_transaction_id
  ON public.apple_iap_notifications (transaction_id);
CREATE INDEX IF NOT EXISTS idx_apple_iap_notifications_type_created
  ON public.apple_iap_notifications (notification_type, created_at);

DROP TRIGGER IF EXISTS apple_iap_notifications_updated_at ON public.apple_iap_notifications;
CREATE TRIGGER apple_iap_notifications_updated_at
  BEFORE UPDATE ON public.apple_iap_notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.apple_iap_notifications ENABLE ROW LEVEL SECURITY;
-- No policies: Apple notification metadata is backend service-role only.

-- ----------------------------------------------------------------------------
-- 6. Allow the student_pass plan_type on user_quota (preserves all existing
--    values; adds the new pass). Effective paid status is still resolved from
--    user_entitlements at read time — this only widens the allowed set.
-- ----------------------------------------------------------------------------
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
    'student_pass',
    'admin'
  ));

-- ----------------------------------------------------------------------------
-- 7. Seed the Student Pass product (idempotent upsert). sales_end_at enforces
--    the cutoff: Phase 2 rejects any verified purchaseDate AFTER this instant.
--    is_purchasable hides/disables NEW purchases without blocking verify/restore
--    of EXISTING purchases.
-- ----------------------------------------------------------------------------
INSERT INTO public.billing_products
  (product_id, plan_type, kind, entitlement_days, display_name, is_purchasable, sales_end_at)
VALUES
  ('com.aydenz.youmilensipad.studentpass30d',
   'student_pass',
   'non_renewing',
   30,
   'Student Pass – 30 Days',
   true,
   '2026-07-19T00:00:00Z')
ON CONFLICT (product_id) DO UPDATE SET
  plan_type        = EXCLUDED.plan_type,
  kind             = EXCLUDED.kind,
  entitlement_days = EXCLUDED.entitlement_days,
  display_name     = EXCLUDED.display_name,
  is_purchasable   = EXCLUDED.is_purchasable,
  sales_end_at     = EXCLUDED.sales_end_at,
  updated_at       = now();

-- ============================================================================
-- VALIDATION QUERIES (run manually in the Supabase SQL editor AFTER applying;
-- these are commented so they are not part of the migration transaction).
-- ============================================================================
-- -- a) Ledger renamed: expect old absent, new present.
-- SELECT to_regclass('public.app_store_subscriptions') AS old_table,
--        to_regclass('public.apple_iap_transactions')  AS new_table;
--
-- -- b) New + renamed columns present on the ledger.
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='apple_iap_transactions'
--    AND column_name IN ('purchase_date','apple_expires_date') ORDER BY column_name;
--
-- -- c) Row count parity: compare against the count you recorded BEFORE applying.
-- SELECT count(*) AS apple_iap_transactions_rows FROM public.apple_iap_transactions;
--
-- -- d) New tables exist.
-- SELECT to_regclass('public.billing_products')  AS billing_products,
--        to_regclass('public.user_entitlements') AS user_entitlements,
--        to_regclass('public.billing_events')    AS billing_events;
--
-- -- e) RLS enabled on all four billing tables.
-- SELECT relname, relrowsecurity FROM pg_class
--  WHERE relname IN ('apple_iap_transactions','billing_products','user_entitlements','billing_events','apple_iap_notifications')
--  ORDER BY relname;
--
-- -- f) user_quota now allows student_pass (constraint text contains it).
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='user_quota_plan_type_check';
--
-- -- g) Seed row correct (entitlement_days=30, cutoff=2026-07-19Z, purchasable).
-- SELECT product_id, plan_type, entitlement_days, is_purchasable, sales_end_at
--   FROM public.billing_products WHERE product_id='com.aydenz.youmilensipad.studentpass30d';
--
-- -- h) Idempotent-grant guard present (UNIQUE on source_transaction_id) and FK.
-- SELECT conname, contype FROM pg_constraint
--  WHERE conrelid='public.user_entitlements'::regclass ORDER BY conname;
--
-- -- i) Replay guard preserved (UNIQUE on transaction_id) on the ledger.
-- SELECT conname FROM pg_constraint
--  WHERE conrelid='public.apple_iap_transactions'::regclass AND contype='u';
--
-- -- j) Deleted-account binding fields exist.
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='apple_iap_transactions'
--    AND column_name IN ('owner_state','account_deleted_at') ORDER BY column_name;
--
-- -- k) Notification UUID dedupe is race-safe.
-- SELECT conname, contype FROM pg_constraint
--  WHERE conrelid='public.apple_iap_notifications'::regclass
--  ORDER BY conname;
--
-- PRODUCTION PREFLIGHT QUERIES (run BEFORE applying; investigate any rows).
-- -- Unexpected legacy ledger plan/status values that would fail new checks.
-- SELECT plan_type, count(*) FROM public.app_store_subscriptions
--  GROUP BY plan_type
--  HAVING plan_type NOT IN ('student_basic','student_plus','student_pro','student_pass');
-- SELECT status, count(*) FROM public.app_store_subscriptions
--  GROUP BY status
--  HAVING status NOT IN ('active','expired','revoked');
-- -- user_quota values that would fail the widened check.
-- SELECT plan_type, count(*) FROM public.user_quota
--  GROUP BY plan_type
--  HAVING plan_type NOT IN ('public_trial','core_tester','student_basic','student_plus','student_pro','student_pass','admin');
-- -- Orphaned legacy ledger users that would fail FK recreation.
-- SELECT count(*) AS orphaned_ledger_users
--   FROM public.app_store_subscriptions s
--   LEFT JOIN auth.users u ON u.id = s.user_id
--  WHERE s.user_id IS NOT NULL AND u.id IS NULL;
-- ============================================================================
