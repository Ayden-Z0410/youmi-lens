-- Run in Supabase SQL Editor after initial setup (adds async AI job columns).
-- Phase 2 (reserved): workers / Edge Functions advance ai_*; the web app does not enqueue from the browser yet.
-- Safe to run multiple times.

alter table public.recordings
  add column if not exists ai_status text not null default 'pending',
  add column if not exists ai_error text null,
  add column if not exists ai_updated_at timestamptz null;

comment on column public.recordings.ai_status is
  'pending | queued | transcribing | summarizing | done | failed';

-- Optional: backfill rows that already have AI output
update public.recordings
set
  ai_status = 'done',
  ai_updated_at = coalesce(ai_updated_at, created_at)
where
  transcript is not null
  and summary_en is not null
  and summary_zh is not null
  and ai_status = 'pending';
