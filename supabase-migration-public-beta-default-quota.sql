-- ============================================================
-- Youmi Lens — public beta default quota fix (TestFlight V1)
-- ============================================================
-- Run once in the Supabase SQL Editor. Safe to run multiple times.
--
-- Problem this fixes:
--   New/unapproved users land on the `public_trial` (free beta) tier with
--   limits that were too small for a real lecture — 10 min per recording and
--   a 20 min LIFETIME cap. Every real lecture (30-90 min) was rejected, so
--   free beta users effectively had zero usable quota.
--
-- V1 free public beta allowance (matches server/betaGate.mjs defaults):
--   plan_type              = public_trial
--   status                 = active
--   max_recordings_per_day = 2          -- 2 lectures per day
--   max_recording_minutes  = 20         -- 20 min per recording
--   total_trial_minutes_limit = 2400    -- generous lifetime backstop only;
--                                          the per-day count is the real gate
--
-- This migration does NOT touch:
--   * admin / core_tester / student_* rows (developer + manually approved testers)
--   * public_trial rows that were manually customized (different limits, or
--     granted bonus minutes via extra_minutes_balance)

-- ── 1. Update column defaults so freshly auto-created rows use V1 limits ──────
ALTER TABLE public.user_quota
  ALTER COLUMN total_trial_minutes_limit SET DEFAULT 2400,
  ALTER COLUMN max_recording_minutes     SET DEFAULT 20,
  ALTER COLUMN max_recordings_per_day    SET DEFAULT 2;

-- ── 2. Heal existing free-beta rows still on the old (too-small) defaults ─────
-- Old defaults were: 20 lifetime min, 10 min/recording, 10 recordings/day.
-- Only rows matching ALL three old defaults AND with no manually granted
-- bonus minutes are updated — so developer/admin and manually authorized
-- testers keep their custom values untouched.
UPDATE public.user_quota
SET total_trial_minutes_limit = 2400,
    max_recording_minutes     = 20,
    max_recordings_per_day    = 2,
    updated_at                = now()
WHERE plan_type = 'public_trial'
  AND extra_minutes_balance = 0
  AND total_trial_minutes_limit = 20
  AND max_recording_minutes = 10
  AND max_recordings_per_day = 10;

-- ── 3. (Optional) Inspect the result ─────────────────────────────────────────
-- SELECT email, plan_type, status, max_recordings_per_day,
--        max_recording_minutes, total_trial_minutes_limit, extra_minutes_balance
-- FROM public.user_quota
-- ORDER BY plan_type, created_at;
