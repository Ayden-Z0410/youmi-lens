-- ============================================================
-- Youmi Lens Beta Usage Tracking
-- Run this once in your Supabase SQL editor.
-- ============================================================

-- ── user_quota ────────────────────────────────────────────────────────────────
-- One row per user. Auto-created by the server on first AI action.
--
-- PLAN TIERS
-- ┌─────────────────┬─────────────────────────────────────────────────────────┐
-- │ public_trial    │ Anyone who signs up via the public beta link.           │
-- │                 │ 20 min lifetime total, max 10 min/recording, 10/day.    │
-- ├─────────────────┼─────────────────────────────────────────────────────────┤
-- │ core_tester     │ Trusted testers (friends at US universities, etc).      │
-- │                 │ 1000 min/month, max 120 min/recording, 20/day.          │
-- ├─────────────────┼─────────────────────────────────────────────────────────┤
-- │ student_basic   │ Reserved for future paid tier (payment not yet built).  │
-- │                 │ Until activated, treated as public_trial limits.        │
-- ├─────────────────┼─────────────────────────────────────────────────────────┤
-- │ student_pro     │ Reserved for future paid tier (payment not yet built).  │
-- │                 │ Until activated, treated as public_trial limits.        │
-- ├─────────────────┼─────────────────────────────────────────────────────────┤
-- │ admin           │ Your own account. Bypass all limits.                    │
-- └─────────────────┴─────────────────────────────────────────────────────────┘
--
-- ADMIN UPGRADES (run in Supabase SQL editor):
--
--   Upgrade to core_tester:
--     UPDATE user_quota
--     SET plan_type = 'core_tester',
--         monthly_minutes_limit = 1000,
--         max_recording_minutes = 120,
--         max_recordings_per_day = 20,
--         max_live_session_minutes = 120
--     WHERE email = 'tester@example.com';
--
--   Upgrade to admin:
--     UPDATE user_quota SET plan_type = 'admin'
--     WHERE email = 'you@example.com';
--
--   Grant bonus minutes without changing plan:
--     UPDATE user_quota SET extra_minutes_balance = extra_minutes_balance + 60
--     WHERE email = 'user@example.com';
--
--   Suspend a user:
--     UPDATE user_quota SET status = 'suspended' WHERE email = 'bad@example.com';

CREATE TABLE IF NOT EXISTS user_quota (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email                       text        NOT NULL,

  -- Plan tier (controlled by admin via SQL)
  plan_type                   text        NOT NULL DEFAULT 'public_trial',

  -- public_trial: lifetime cap in minutes (across all time, never resets)
  total_trial_minutes_limit   integer     NOT NULL DEFAULT 20,

  -- core_tester / future paid tiers: per-calendar-month cap; NULL = unlimited (admin)
  monthly_minutes_limit       integer,

  -- Per-recording limits (checked at upload + process time)
  max_recording_minutes       integer     NOT NULL DEFAULT 10,

  -- Daily processing limit (UTC day, counts process_recording + regenerate_summary)
  max_recordings_per_day      integer     NOT NULL DEFAULT 10,

  -- Live caption session cap (server disconnects after this many minutes)
  max_live_session_minutes    integer     NOT NULL DEFAULT 10,

  -- Manually grantable bonus minutes (additive on top of plan limits)
  extra_minutes_balance       integer     NOT NULL DEFAULT 0,

  -- 'active' | 'suspended'
  status                      text        NOT NULL DEFAULT 'active',

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_quota_updated_at ON user_quota;
CREATE TRIGGER user_quota_updated_at
  BEFORE UPDATE ON user_quota
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Validate plan_type
ALTER TABLE user_quota
  DROP CONSTRAINT IF EXISTS user_quota_plan_type_check;
ALTER TABLE user_quota
  ADD CONSTRAINT user_quota_plan_type_check
  CHECK (plan_type IN ('public_trial', 'core_tester', 'student_basic', 'student_pro', 'admin'));

-- Validate status
ALTER TABLE user_quota
  DROP CONSTRAINT IF EXISTS user_quota_status_check;
ALTER TABLE user_quota
  ADD CONSTRAINT user_quota_status_check
  CHECK (status IN ('active', 'suspended'));

-- RLS: users can read their own quota; only service role can write
ALTER TABLE user_quota ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_quota_select_own" ON user_quota;
CREATE POLICY "user_quota_select_own"
  ON user_quota FOR SELECT
  USING (auth.uid() = user_id);


-- ── beta_usage ────────────────────────────────────────────────────────────────
-- Append-only ledger of all AI actions. Never delete rows.
--
-- action_type (controlled set):
--   upload_audio          Cloud audio upload (logged for monitoring; not billable)
--   process_recording     First transcription + summary — PRIMARY BILLABLE EVENT
--   regenerate_summary    Re-run on already-processed recording — also billable
--   transcription         Direct /api/transcribe call (BYOK / standalone)
--   summary_generation    Direct /api/summarize call (BYOK / standalone)
--   live_caption_session  One continuous live caption session (billable_minutes = 0)
--   translate_caption     Per-segment translation (billable_minutes = 0; not counted)
--
-- For quota enforcement, only process_recording and regenerate_summary
-- contribute to used_minutes. Other types are monitoring-only.

CREATE TABLE IF NOT EXISTS beta_usage (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email            text         NOT NULL,
  recording_id     uuid,
  action_type      text         NOT NULL,
  duration_sec     integer      NOT NULL DEFAULT 0,
  billable_minutes numeric(8,2) NOT NULL DEFAULT 0,
  created_at       timestamptz  NOT NULL DEFAULT now()
);

-- Fast lookups for quota checks
CREATE INDEX IF NOT EXISTS idx_beta_usage_user_action_date
  ON beta_usage (user_id, action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_beta_usage_recording
  ON beta_usage (user_id, recording_id, action_type);

-- RLS: users read their own usage; only service role writes
ALTER TABLE beta_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "beta_usage_select_own" ON beta_usage;
CREATE POLICY "beta_usage_select_own"
  ON beta_usage FOR SELECT
  USING (auth.uid() = user_id);
