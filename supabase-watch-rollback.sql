-- ============================================================
-- Youmi Watch — data layer ROLLBACK (Phase 1)
--
-- Drops everything created by supabase-watch-setup.sql. Idempotent: safe to
-- re-run. Run in your Supabase SQL editor only if you need to fully remove the
-- Youmi Watch tables.
--
-- DESTRUCTIVE: dropping these tables deletes all rows (cost ledger, snapshots,
-- alerts, alert rules, config). There is no recovery from this file.
--
-- SAFETY
--   • Does NOT drop the shared set_updated_at() function — it is used by other
--     tables (e.g. user_quota_updated_at) and must remain.
--   • Does NOT touch any existing table: user_quota, beta_usage, recordings,
--     profiles, signup_codes, app_store_subscriptions, or auth.users.
--   • DROP TABLE automatically removes that table's indexes, constraints, and
--     triggers, so no separate index/constraint drops are required. The
--     explicit DROP TRIGGER lines below are belt-and-suspenders only.
-- ============================================================

-- Triggers (redundant with DROP TABLE, listed explicitly for clarity).
DROP TRIGGER IF EXISTS watch_alerts_updated_at      ON public.watch_alerts;
DROP TRIGGER IF EXISTS watch_alert_rules_updated_at ON public.watch_alert_rules;
DROP TRIGGER IF EXISTS watch_config_updated_at      ON public.watch_config;

-- Tables — dropped in dependency order (watch_alerts references
-- watch_alert_rules). CASCADE is defensive only; the ordering already avoids
-- any dependency error.
DROP TABLE IF EXISTS public.watch_alerts             CASCADE;
DROP TABLE IF EXISTS public.watch_alert_rules        CASCADE;
DROP TABLE IF EXISTS public.watch_provider_snapshots CASCADE;
DROP TABLE IF EXISTS public.watch_cost_events        CASCADE;
DROP TABLE IF EXISTS public.watch_config             CASCADE;

-- NOTE: public.set_updated_at() is intentionally NOT dropped — it is shared
-- with other tables and removing it would break their updated_at triggers.
