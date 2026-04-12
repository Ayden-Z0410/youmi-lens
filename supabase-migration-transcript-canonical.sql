-- Raw vs canonical transcripts (run in Supabase SQL editor).
-- transcript / live_transcript = canonical (display + summarize input)
-- transcript_raw / live_transcript_raw = provider or assembled stream output

alter table public.recordings
  add column if not exists transcript_raw text,
  add column if not exists live_transcript_raw text;

comment on column public.recordings.transcript is 'Canonical transcript after normalization (summary + UI primary).';
comment on column public.recordings.transcript_raw is 'Raw ASR/file transcription before canonicalization.';
comment on column public.recordings.live_transcript is 'Canonical in-class caption text (display).';
comment on column public.recordings.live_transcript_raw is 'Raw assembled live caption text before canonicalization.';
