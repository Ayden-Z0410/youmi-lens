-- ============================================================
-- Youmi Lens — signup verification codes (iPad in-app Create Profile)
-- ============================================================
-- Run once in the Supabase SQL Editor.
--
-- Backs the verification-code-first signup flow: a hashed 8-digit code is
-- stored here when /api/auth/send-signup-code is called; the Supabase Auth
-- user is only created once /api/auth/verify-signup-code-and-create-user
-- confirms the code. Only the backend (service role) touches this table.

create table if not exists public.signup_codes (
  id          uuid        primary key default gen_random_uuid(),
  email       text        not null,
  username    text        not null,
  -- SHA-256 of the code salted with the email. Plaintext codes are never stored.
  code_hash   text        not null,
  expires_at  timestamptz not null,
  consumed    boolean     not null default false,
  attempts    integer     not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists signup_codes_email_created_idx
  on public.signup_codes (email, created_at desc);

-- Service-role only. RLS enabled with NO policies blocks all anon/authenticated
-- access; the backend uses the service-role key, which bypasses RLS.
alter table public.signup_codes enable row level security;
