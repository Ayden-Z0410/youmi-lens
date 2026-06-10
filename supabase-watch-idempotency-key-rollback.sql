-- ============================================================
-- Youmi Watch — ROLLBACK of the cost-ledger idempotency key (Phase 5C-1)
--
-- Reverses supabase-watch-idempotency-key.sql. Idempotent: safe to re-run.
--
-- SAFETY
--   • Touches ONLY public.watch_cost_events. No other table is modified.
--   • Drops the partial UNIQUE index, then the column. Dropping the column
--     removes the idempotency_key values only — all other columns and rows of
--     the cost ledger are preserved.
--   • Does not drop or alter any other constraint, trigger, function, RLS
--     policy, or table.
-- ============================================================

DROP INDEX IF EXISTS public.uq_watch_cost_events_idempotency_key;

ALTER TABLE public.watch_cost_events
  DROP COLUMN IF EXISTS idempotency_key;
