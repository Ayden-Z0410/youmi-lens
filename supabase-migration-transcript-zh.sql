-- Migration: Chinese transcript column for the recordings table.
--
-- Youmi Lens V1 is English lecture audio with Chinese study support. The
-- backend already stores an English transcript in `transcript`; this adds
-- `transcript_zh`, which holds the Chinese translation of that transcript,
-- generated backend-side during post-class processing (see processRecording.mjs).
--
-- Safe to run multiple times. Existing rows keep transcript_zh = NULL until
-- they are (re)processed. The existing `transcript` column is left untouched.

alter table public.recordings
  add column if not exists transcript_zh text;
