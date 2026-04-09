-- Optional: tighten recordings UPDATE RLS with explicit WITH CHECK (Postgres / Supabase).
-- Run in SQL Editor if updates fail with RLS while SELECT/INSERT work.
-- Safe to run multiple times.

drop policy if exists "recordings_update_own" on public.recordings;

create policy "recordings_update_own"
  on public.recordings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
