-- ============================================================
-- Youmi Watch — internal data layer (Phase 1: tables only)
--
-- Run this once in your Supabase SQL editor. Idempotent: safe to re-run.
--
-- SECURITY POSTURE
--   These are internal admin-monitoring tables (platform-wide), NOT per-user
--   data. RLS is ENABLED with NO anon/authenticated policies, which means
--   deny-by-default for the public/auth client roles. All reads and writes go
--   through the server using the Supabase service-role key (which bypasses
--   RLS), behind the /api/admin/watch/* endpoints that already verify the
--   Supabase JWT + user_quota.plan_type ∈ {admin, developer}.
--
--   Provider API keys / secrets are NEVER stored in these tables (including the
--   `metadata` jsonb). The `watch_cost_events` ledger is our own source of
--   truth; external provider APIs are only used later for reconciliation.
--
-- This file does NOT modify any existing table (user_quota, beta_usage,
-- recordings, profiles, signup_codes, app_store_subscriptions, auth.users).
-- ============================================================

-- ── Shared updated_at trigger ───────────────────────────────────────────────
-- Reuses the project's existing set_updated_at() (defined in
-- supabase-beta-setup.sql). CREATE OR REPLACE is idempotent and the body is
-- identical, so this is safe whether or not the function already exists, and
-- does not disturb existing triggers (e.g. user_quota_updated_at).
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- 1. watch_cost_events — append-only internal usage/cost ledger (source of truth)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.watch_cost_events (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  provider           text          NOT NULL,
  event_type         text          NOT NULL,
  -- Optional attribution. SET NULL (not CASCADE) so cost history survives user
  -- deletion — this is an operational/financial record, unlike beta_usage.
  user_id            uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Soft link only (recordings may be deleted); intentionally no hard FK.
  recording_id       uuid,
  quantity           numeric(14,4) NOT NULL DEFAULT 0,
  unit               text          NOT NULL,
  -- OUR estimate from internal pricing constants — never provider billing.
  estimated_cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  status             text          NOT NULL DEFAULT 'recorded',
  source             text          NOT NULL DEFAULT 'internal',
  -- Small, NON-SECRET context only. Never store keys/tokens here.
  metadata           jsonb,
  occurred_at        timestamptz   NOT NULL DEFAULT now(),
  created_at         timestamptz   NOT NULL DEFAULT now()
);

-- CHECK constraints applied idempotently (drop-if-exists then add) so re-runs
-- and any pre-existing table converge to the correct definition.
ALTER TABLE public.watch_cost_events DROP CONSTRAINT IF EXISTS watch_cost_events_provider_check;
ALTER TABLE public.watch_cost_events
  ADD CONSTRAINT watch_cost_events_provider_check
  CHECK (provider IN ('deepgram','dashscope','brevo','railway','supabase','openai'));

ALTER TABLE public.watch_cost_events DROP CONSTRAINT IF EXISTS watch_cost_events_status_check;
ALTER TABLE public.watch_cost_events
  ADD CONSTRAINT watch_cost_events_status_check
  CHECK (status IN ('recorded','reconciled','failed'));

ALTER TABLE public.watch_cost_events DROP CONSTRAINT IF EXISTS watch_cost_events_source_check;
ALTER TABLE public.watch_cost_events
  ADD CONSTRAINT watch_cost_events_source_check
  CHECK (source IN ('internal','provider','reconciled'));

CREATE INDEX IF NOT EXISTS idx_watch_cost_events_provider
  ON public.watch_cost_events (provider, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_cost_events_event_type
  ON public.watch_cost_events (event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_cost_events_occurred
  ON public.watch_cost_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_cost_events_user
  ON public.watch_cost_events (user_id, occurred_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_watch_cost_events_recording
  ON public.watch_cost_events (recording_id, occurred_at DESC) WHERE recording_id IS NOT NULL;

-- RLS: enabled, NO policies → deny-all for anon/authenticated. Server-only.
ALTER TABLE public.watch_cost_events ENABLE ROW LEVEL SECURITY;


-- ════════════════════════════════════════════════════════════════════════════
-- 2. watch_provider_snapshots — append-only provider health/usage snapshots
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.watch_provider_snapshots (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  provider           text          NOT NULL,
  status             text          NOT NULL,
  latency_ms         integer,
  health_pct         numeric(5,2),
  usage_value        numeric(14,4),
  usage_unit         text,
  quota_used_pct     numeric(5,2),
  estimated_cost_usd numeric(12,6),
  detail             text,
  metadata           jsonb,
  captured_at        timestamptz   NOT NULL DEFAULT now(),
  created_at         timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE public.watch_provider_snapshots DROP CONSTRAINT IF EXISTS watch_provider_snapshots_provider_check;
ALTER TABLE public.watch_provider_snapshots
  ADD CONSTRAINT watch_provider_snapshots_provider_check
  CHECK (provider IN ('deepgram','dashscope','brevo','railway','supabase','openai'));

ALTER TABLE public.watch_provider_snapshots DROP CONSTRAINT IF EXISTS watch_provider_snapshots_status_check;
ALTER TABLE public.watch_provider_snapshots
  ADD CONSTRAINT watch_provider_snapshots_status_check
  CHECK (status IN ('operational','degraded','offline','warning','unknown'));

CREATE INDEX IF NOT EXISTS idx_watch_provider_snapshots_provider
  ON public.watch_provider_snapshots (provider, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_provider_snapshots_captured
  ON public.watch_provider_snapshots (captured_at DESC);

ALTER TABLE public.watch_provider_snapshots ENABLE ROW LEVEL SECURITY;


-- ════════════════════════════════════════════════════════════════════════════
-- 3. watch_alert_rules — configurable alert thresholds (mutable)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.watch_alert_rules (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        text          NOT NULL,
  name            text          NOT NULL,
  condition       text          NOT NULL,
  operator        text          NOT NULL DEFAULT 'gt',
  threshold_value numeric(14,4),
  threshold_text  text,
  threshold_unit  text,
  severity        text          NOT NULL DEFAULT 'warning',
  channel         text          NOT NULL DEFAULT 'email',
  enabled         boolean       NOT NULL DEFAULT true,
  created_by      uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE public.watch_alert_rules DROP CONSTRAINT IF EXISTS watch_alert_rules_provider_check;
ALTER TABLE public.watch_alert_rules
  ADD CONSTRAINT watch_alert_rules_provider_check
  CHECK (provider IN ('deepgram','dashscope','brevo','railway','supabase','openai'));

ALTER TABLE public.watch_alert_rules DROP CONSTRAINT IF EXISTS watch_alert_rules_operator_check;
ALTER TABLE public.watch_alert_rules
  ADD CONSTRAINT watch_alert_rules_operator_check
  CHECK (operator IN ('gt','lt','gte','lte','eq'));

ALTER TABLE public.watch_alert_rules DROP CONSTRAINT IF EXISTS watch_alert_rules_severity_check;
ALTER TABLE public.watch_alert_rules
  ADD CONSTRAINT watch_alert_rules_severity_check
  CHECK (severity IN ('critical','warning','info'));

ALTER TABLE public.watch_alert_rules DROP CONSTRAINT IF EXISTS watch_alert_rules_channel_check;
ALTER TABLE public.watch_alert_rules
  ADD CONSTRAINT watch_alert_rules_channel_check
  CHECK (channel IN ('email','desktop','none'));

CREATE INDEX IF NOT EXISTS idx_watch_alert_rules_provider_enabled
  ON public.watch_alert_rules (provider, enabled);
CREATE INDEX IF NOT EXISTS idx_watch_alert_rules_enabled
  ON public.watch_alert_rules (enabled);
CREATE INDEX IF NOT EXISTS idx_watch_alert_rules_condition
  ON public.watch_alert_rules (condition);

DROP TRIGGER IF EXISTS watch_alert_rules_updated_at ON public.watch_alert_rules;
CREATE TRIGGER watch_alert_rules_updated_at
  BEFORE UPDATE ON public.watch_alert_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.watch_alert_rules ENABLE ROW LEVEL SECURITY;


-- ════════════════════════════════════════════════════════════════════════════
-- 4. watch_alerts — fired alerts (mutable: acknowledge / resolve)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.watch_alerts (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id         uuid          REFERENCES public.watch_alert_rules(id) ON DELETE SET NULL,
  provider        text,
  severity        text          NOT NULL,
  status          text          NOT NULL DEFAULT 'active',
  title           text          NOT NULL,
  detail          text,
  trigger_expr    text,
  related_metric  text,
  related_value   numeric(14,4),
  acknowledged_by uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_at timestamptz,
  resolved_at     timestamptz,
  first_seen_at   timestamptz   NOT NULL DEFAULT now(),
  last_seen_at    timestamptz   NOT NULL DEFAULT now(),
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE public.watch_alerts DROP CONSTRAINT IF EXISTS watch_alerts_provider_check;
ALTER TABLE public.watch_alerts
  ADD CONSTRAINT watch_alerts_provider_check
  CHECK (provider IS NULL OR provider IN ('deepgram','dashscope','brevo','railway','supabase','openai'));

ALTER TABLE public.watch_alerts DROP CONSTRAINT IF EXISTS watch_alerts_severity_check;
ALTER TABLE public.watch_alerts
  ADD CONSTRAINT watch_alerts_severity_check
  CHECK (severity IN ('critical','warning','info'));

ALTER TABLE public.watch_alerts DROP CONSTRAINT IF EXISTS watch_alerts_status_check;
ALTER TABLE public.watch_alerts
  ADD CONSTRAINT watch_alerts_status_check
  CHECK (status IN ('active','acknowledged','resolved'));

CREATE INDEX IF NOT EXISTS idx_watch_alerts_status_severity
  ON public.watch_alerts (status, severity, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_alerts_provider_status
  ON public.watch_alerts (provider, status);
CREATE INDEX IF NOT EXISTS idx_watch_alerts_rule
  ON public.watch_alerts (rule_id);
CREATE INDEX IF NOT EXISTS idx_watch_alerts_last_seen
  ON public.watch_alerts (last_seen_at DESC);

DROP TRIGGER IF EXISTS watch_alerts_updated_at ON public.watch_alerts;
CREATE TRIGGER watch_alerts_updated_at
  BEFORE UPDATE ON public.watch_alerts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.watch_alerts ENABLE ROW LEVEL SECURITY;


-- ════════════════════════════════════════════════════════════════════════════
-- 5. watch_config — small admin config store (budget, notifications, data mode)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.watch_config (
  key         text         PRIMARY KEY,
  value       jsonb        NOT NULL,
  description text,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS watch_config_updated_at ON public.watch_config;
CREATE TRIGGER watch_config_updated_at
  BEFORE UPDATE ON public.watch_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.watch_config ENABLE ROW LEVEL SECURITY;


-- ════════════════════════════════════════════════════════════════════════════
-- Seed: default alert rules (idempotent)
--
-- Seeded via INSERT ... SELECT ... WHERE NOT EXISTS keyed on (provider,
-- condition) rather than ON CONFLICT, because adding a UNIQUE constraint on
-- (provider, condition, threshold_unit) would forbid having multiple enabled
-- thresholds for the same metric later (e.g. storage_used warning @75% AND
-- critical @90%). The NOT EXISTS guard is fully idempotent (re-runs insert
-- nothing) without constraining future multi-threshold rules.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.watch_alert_rules
  (provider, name, condition, operator, threshold_value, threshold_text, threshold_unit, severity, channel, enabled)
SELECT v.provider, v.name, v.condition, v.operator, v.threshold_value, v.threshold_text, v.threshold_unit, v.severity, v.channel, v.enabled
FROM (VALUES
  ('deepgram', 'Deepgram monthly minutes warning', 'monthly_minutes',   'gte', 80::numeric,   NULL::text,  'percent', 'warning',  'email', true),
  ('dashscope','DashScope daily cost limit',        'daily_cost',        'gte', 3::numeric,    NULL::text,  'usd',     'warning',  'email', true),
  ('supabase', 'Supabase storage warning',          'storage_used',      'gte', 75::numeric,   NULL::text,  'percent', 'warning',  'email', true),
  ('brevo',    'Brevo credit minimum',              'credits_remaining', 'lte', 500::numeric,  NULL::text,  'count',   'warning',  'email', true),
  ('railway',  'Railway service health',            'service_health',    'eq',  NULL::numeric, 'offline',   'status',  'critical', 'email', true)
) AS v(provider, name, condition, operator, threshold_value, threshold_text, threshold_unit, severity, channel, enabled)
WHERE NOT EXISTS (
  SELECT 1 FROM public.watch_alert_rules r
  WHERE r.provider = v.provider AND r.condition = v.condition
);


-- ════════════════════════════════════════════════════════════════════════════
-- Seed: watch_config defaults (idempotent via ON CONFLICT on the key PK)
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.watch_config (key, value, description) VALUES
  (
    'monthly_budget_usd',
    '2500'::jsonb,
    'Monthly Youmi Watch cost budget in USD.'
  ),
  (
    'notification_channels',
    '{"email":{"enabled":true,"target":"developer_email"},"desktop":{"enabled":true,"target":"local_device"},"slack":{"enabled":false,"target":null},"discord":{"enabled":false,"target":null}}'::jsonb,
    'Mock notification channel config (no real delivery wired yet).'
  ),
  (
    'data_mode',
    '"mock_until_connected"'::jsonb,
    'Data source mode for Youmi Watch: mock until the internal ledger is connected.'
  )
ON CONFLICT (key) DO NOTHING;
