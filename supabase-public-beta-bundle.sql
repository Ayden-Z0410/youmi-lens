-- =============================================================================
-- Youmi Lens: public beta bundle (idempotent). Run in Supabase SQL Editor.
-- Dashboard -> your project -> SQL -> New query -> paste all -> Run.
-- Use your existing Supabase project; order: recordings + Storage, ai_*, profiles.
-- =============================================================================

-- --- Part A: supabase-setup.sql ---
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

-- --- Part B: supabase-migration-ai-status.sql ---
-- Safe to run multiple times.

alter table public.recordings
  add column if not exists ai_status text not null default 'pending',
  add column if not exists ai_error text null,
  add column if not exists ai_updated_at timestamptz null;

comment on column public.recordings.ai_status is
  'pending | queued | transcribing | summarizing | done | failed';

update public.recordings
set
  ai_status = 'done',
  ai_updated_at = coalesce(ai_updated_at, created_at)
where
  transcript is not null
  and summary_en is not null
  and summary_zh is not null
  and ai_status = 'pending';

-- --- Part C: supabase-migration-profiles.sql ---
-- User profile for V1 onboarding (username) + optional phone.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text,
  phone text,
  first_shell_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_unique
  on public.profiles (lower(trim(username)))
  where username is not null and trim(username) <> '';

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- --- Part D: profile_display_name_taken RPC (optional prefetch for onboarding/settings) ---
create or replace function public.profile_display_name_taken(p_candidate text, p_self uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id is distinct from p_self
      and length(trim(coalesce(p_candidate, ''))) > 0
      and length(trim(coalesce(p.username, ''))) > 0
      and lower(trim(p.username)) = lower(trim(p_candidate))
  );
$$;

revoke all on function public.profile_display_name_taken(text, uuid) from public;
grant execute on function public.profile_display_name_taken(text, uuid) to authenticated;
