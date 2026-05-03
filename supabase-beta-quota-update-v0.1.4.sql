-- Youmi Lens public beta quota adjustment for v0.1.4.
-- Keeps public trial minutes unchanged while allowing more short test recordings.

UPDATE public.user_quota
SET max_recordings_per_day = 10,
    updated_at = now()
WHERE plan_type = 'public_trial'
  AND max_recordings_per_day <> 10;

UPDATE public.user_quota
SET max_recordings_per_day = 20,
    updated_at = now()
WHERE plan_type = 'core_tester'
  AND max_recordings_per_day <> 20;
