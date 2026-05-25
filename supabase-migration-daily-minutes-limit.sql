-- Migration: add per-day minute cap to user_quota.
--
-- Why: free-beta launch needs a strict daily minute ceiling on billable AI
-- processing (process_recording + regenerate_summary). Until now the daily
-- exposure was bounded only by max_recordings_per_day * max_recording_minutes,
-- which is a loose product and not the spec.
--
-- Shape: nullable integer. NULL = no daily cap (used for admin / unlimited
-- accounts). All other tiers get a real number. Server-side PLAN_LIMITS in
-- server/betaGate.mjs is the runtime source of truth — the planLimit() helper
-- reads PLAN_LIMITS first and only falls back to the row value, so this
-- backfill is a safety net for tooling that reads user_quota directly.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS and the WHERE ... IS NULL guards
-- make the script idempotent. No existing constraints are dropped.

ALTER TABLE public.user_quota
  ADD COLUMN IF NOT EXISTS daily_minutes_limit integer;

COMMENT ON COLUMN public.user_quota.daily_minutes_limit IS
  'Per-UTC-day cap on billable AI processing minutes (sum of beta_usage.billable_minutes for action_type in (process_recording, regenerate_summary)). NULL = no daily cap (admin / unlimited). Runtime authority lives in server PLAN_LIMITS.';

-- Backfill existing rows by plan_type. Idempotent: only writes when the
-- column is still NULL on that row.
UPDATE public.user_quota
SET    daily_minutes_limit = 120
WHERE  plan_type = 'public_trial'
  AND  daily_minutes_limit IS NULL;

UPDATE public.user_quota
SET    daily_minutes_limit = 240
WHERE  plan_type = 'core_tester'
  AND  daily_minutes_limit IS NULL;

UPDATE public.user_quota
SET    daily_minutes_limit = 120
WHERE  plan_type = 'student_basic'
  AND  daily_minutes_limit IS NULL;

UPDATE public.user_quota
SET    daily_minutes_limit = 240
WHERE  plan_type = 'student_plus'
  AND  daily_minutes_limit IS NULL;

UPDATE public.user_quota
SET    daily_minutes_limit = 360
WHERE  plan_type = 'student_pro'
  AND  daily_minutes_limit IS NULL;

-- 'admin' rows intentionally left NULL (unlimited / bypass).
