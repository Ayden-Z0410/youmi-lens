-- ============================================================
-- Youmi Watch — durable idempotency key for the cost ledger (Phase 5C-1)
--
-- Adds an OPTIONAL idempotency_key to public.watch_cost_events so high-risk
-- writers (e.g. Deepgram live sessions, which can close through several paths)
-- cannot durably double-write a cost event for the same logical session. The
-- DB enforces "at most one row per key" via a partial UNIQUE index; the
-- application treats a unique-violation on this key as a safe duplicate.
--
-- Idempotent: safe to re-run (ADD COLUMN IF NOT EXISTS + CREATE UNIQUE INDEX
-- IF NOT EXISTS). Run in your Supabase SQL editor AFTER supabase-watch-setup.sql.
--
-- SAFETY
--   • Touches ONLY public.watch_cost_events. No other table is modified.
--   • Adds a single NULLABLE column with no default — existing rows are left
--     exactly as they are (idempotency_key = NULL). No backfill, no rewrite.
--   • The UNIQUE index is PARTIAL (WHERE idempotency_key IS NOT NULL), so the
--     many existing/legacy rows with a NULL key are unconstrained and can
--     coexist freely; only non-null keys must be unique.
--   • Does not drop or alter any constraint, trigger, function, or RLS policy.
-- ============================================================

-- 1. Nullable, no-default column. Existing rows stay NULL (unconstrained).
ALTER TABLE public.watch_cost_events
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- 2. Partial UNIQUE index: at most one row per non-null idempotency_key.
--    NULLs are excluded from the index, so legacy/keyless rows are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_watch_cost_events_idempotency_key
  ON public.watch_cost_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
