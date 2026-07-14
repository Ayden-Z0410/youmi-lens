-- Generic multilingual summary fields for public.recordings.
--
-- Adds language-agnostic summary columns so a lecture's summary can follow its
-- persisted source_language / translation_language pair, instead of the fixed
-- English/Chinese contract. The legacy summary_en / summary_zh columns are kept
-- for backward compatibility (old lectures + language-based mirroring).
--
-- Idempotent and additive: safe to run more than once; nullable columns so
-- existing rows and pre-deploy code are unaffected.
--
-- STAGING ONLY. Do not apply to production in this pass.

ALTER TABLE public.recordings ADD COLUMN IF NOT EXISTS source_summary     text;
ALTER TABLE public.recordings ADD COLUMN IF NOT EXISTS translated_summary text;

COMMENT ON COLUMN public.recordings.source_summary     IS 'Summary in the lecture source_language (authoritative). Mirrors into summary_en/summary_zh only when that language is English/Chinese.';
COMMENT ON COLUMN public.recordings.translated_summary IS 'Summary in the lecture translation_language when source != target (authoritative). Null when source == target.';

-- Rollback (staging only, if ever needed):
--   ALTER TABLE public.recordings DROP COLUMN IF EXISTS translated_summary;
--   ALTER TABLE public.recordings DROP COLUMN IF EXISTS source_summary;
