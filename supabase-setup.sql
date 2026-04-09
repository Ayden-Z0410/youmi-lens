-- Youmi Lens: run this entire file in Supabase SQL Editor (Dashboard -> SQL).
-- Creates recordings table, private Storage bucket "lecture-audio", and RLS policies.
-- If you already ran an older version of this file, apply supabase-migration-ai-status.sql for ai_* columns.

create table if not exists public.recordings (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  course text not null,
  title text not null,
  created_at timestamptz not null default now(),
  duration_sec int not null,
  mime text not null,
  storage_path text not null,
  transcript text,
  summary_en text,
  summary_zh text,
  live_transcript text,
  ai_status text not null default 'pending',
  ai_error text null,
  ai_updated_at timestamptz null
);

create index if not exists recordings_user_created
  on public.recordings (user_id, created_at desc);

alter table public.recordings enable row level security;

drop policy if exists "recordings_select_own" on public.recordings;
drop policy if exists "recordings_insert_own" on public.recordings;
drop policy if exists "recordings_update_own" on public.recordings;
drop policy if exists "recordings_delete_own" on public.recordings;

create policy "recordings_select_own"
  on public.recordings for select
  using (auth.uid() = user_id);

create policy "recordings_insert_own"
  on public.recordings for insert
  with check (auth.uid() = user_id);

create policy "recordings_update_own"
  on public.recordings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "recordings_delete_own"
  on public.recordings for delete
  using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('lecture-audio', 'lecture-audio', false)
on conflict (id) do nothing;

drop policy if exists "audio_insert_own" on storage.objects;
drop policy if exists "audio_select_own" on storage.objects;
drop policy if exists "audio_update_own" on storage.objects;
drop policy if exists "audio_delete_own" on storage.objects;

create policy "audio_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'lecture-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "audio_select_own"
  on storage.objects for select
  using (
    bucket_id = 'lecture-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "audio_update_own"
  on storage.objects for update
  using (
    bucket_id = 'lecture-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "audio_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'lecture-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
