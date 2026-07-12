-- Youmi Lens Phase 1: persist each recording's caption/translation language
-- snapshot and language-neutral translated transcript fields.
--
-- Proposal only: do not apply until the matching application changes are ready.
-- Existing English -> Simplified Chinese rows retain their historical behavior
-- through the defaults. Legacy transcript_zh / summary_en / summary_zh columns
-- are intentionally unchanged.

alter table public.recordings
  add column if not exists source_language text not null default 'en',
  add column if not exists translation_language text not null default 'zh-Hans',
  add column if not exists translated_transcript text null,
  add column if not exists translated_live_transcript text null;

comment on column public.recordings.source_language is
  'App content-language code snapshotted when the lecture starts; defaults old rows to en.';

comment on column public.recordings.translation_language is
  'App content-language code snapshotted when the lecture starts; defaults old rows to zh-Hans.';

comment on column public.recordings.translated_transcript is
  'Language-neutral translated transcript in translation_language; never place non-Chinese text in transcript_zh.';

comment on column public.recordings.translated_live_transcript is
  'Language-neutral translated live-caption transcript in translation_language.';
