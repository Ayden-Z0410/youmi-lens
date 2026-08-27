-- Youmi Lens Desktop — Stage 4 Cloud Library schema contract
--
-- STAGING FIRST. This is additive and idempotent; do not run it against
-- production until the owner has completed the report-only production gate.
--
-- Contract source: Desktop Cloud Library repositories plus the current iPad
-- Cloud Marks V1 contract. In particular, marked_timestamps is JSONB whose
-- client value is a number[] of millisecond offsets (not structured marks).
--
-- Deliberately absent:
--   * data backfills for per-field freshness clocks;
--   * RLS policy changes;
--   * updated_at triggers; and
--   * Realtime publication changes.
-- Existing clients explicitly write their field-specific clocks. A generic
-- trigger would incorrectly advance them on unrelated transcript/AI updates.

begin;

-- Phase 1B membership compatibility. updated_at retains the historical
-- NOT NULL/default contract; its default applies only when an old client omits
-- it. The Stage 4 field clocks below intentionally remain NULL for legacy rows.
alter table public.recordings
  add column if not exists course_id uuid null,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz null,
  add column if not exists deletion_updated_at timestamptz null,
  add column if not exists title_updated_at timestamptz null,
  add column if not exists notes text null,
  add column if not exists notes_updated_at timestamptz null,
  add column if not exists marked_timestamps jsonb null default '[]'::jsonb,
  add column if not exists marks_updated_at timestamptz null;

-- Cloud Marks V1 permits an explicit legacy NULL, while uploads that omit
-- marks must receive an empty array. This is metadata-only: no existing row is
-- rewritten or backfilled.
alter table public.recordings
  alter column marked_timestamps drop not null,
  alter column marked_timestamps set default '[]'::jsonb;

-- Course visual identity is part of the existing Desktop/iPad shared shape.
-- Nullable columns preserve legacy rows and name-only clients. Course deletion
-- has its own clock so delete and restore are both ordered decisions.
alter table public.courses
  add column if not exists icon text null,
  add column if not exists tint text null,
  add column if not exists accent text null,
  add column if not exists deleted_at timestamptz null,
  add column if not exists deletion_updated_at timestamptz null;

-- These are lookup indexes only; they neither alter rows nor loosen RLS.
create index if not exists recordings_user_deleted_at_idx
  on public.recordings (user_id, deleted_at);
create index if not exists courses_user_deleted_at_idx
  on public.courses (user_id, deleted_at);

comment on column public.recordings.marked_timestamps is
  'Cloud Marks V1 JSONB number[] of millisecond offsets; order and duplicates are preserved.';
comment on column public.recordings.deletion_updated_at is
  'Freshness clock ordering both lecture soft-delete and restore.';
comment on column public.courses.deletion_updated_at is
  'Freshness clock ordering both course soft-delete and restore.';

commit;

-- No rollback artifact is supplied. Dropping these columns after clients have
-- written notes, marks, or deletion clocks would irreversibly destroy user data.

-- STAGING post-apply verification (read-only):
-- select table_name, column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name in ('recordings', 'courses')
--   and column_name in (
--     'course_id', 'updated_at', 'deleted_at', 'deletion_updated_at',
--     'title_updated_at', 'notes', 'notes_updated_at', 'marked_timestamps',
--     'marks_updated_at', 'icon', 'tint', 'accent'
--   )
-- order by table_name, ordinal_position;
