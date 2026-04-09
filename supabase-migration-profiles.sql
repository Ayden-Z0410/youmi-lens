-- Run in Supabase SQL Editor after supabase-setup.sql.
-- User profile for V1 onboarding (username) + optional phone.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text,
  phone text,
  first_shell_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Global display-name uniqueness (case-insensitive, trimmed). App maps collisions to friendly copy.
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
