-- V1 pipeline: readiness flags + optional timing JSON (run once in Supabase SQL Editor).
alter table public.recordings
  add column if not exists transcript_ready boolean not null default false,
  add column if not exists summary_ready boolean not null default false,
  add column if not exists translation_ready boolean not null default false,
  add column if not exists ai_pipeline_timing jsonb;

comment on column public.recordings.transcript_ready is 'After-class: canonical transcript persisted and usable.';
comment on column public.recordings.summary_ready is 'Bilingual summaries (EN+ZH) persisted successfully.';
comment on column public.recordings.translation_ready is 'ZH summary leg available (same job as summary for hosted Qwen path).';
comment on column public.recordings.ai_pipeline_timing is 'Server timings ms since job start, e.g. transcript_ready_ms, summary_ready_ms.';
