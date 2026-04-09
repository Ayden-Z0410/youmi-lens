-- Optional: lets the app check display-name collisions before upsert (RLS hides other users' rows).
-- Run in Supabase SQL Editor after profiles table exists.
-- Compares using lower(trim(...)) to match index profiles_username_lower_unique.

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
