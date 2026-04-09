# Async transcribe: staged plan (schema first, worker later)

## Phase 1 (in this repo now)

- **Schema:** `ai_status`, `ai_error`, `ai_updated_at` on `public.recordings`. Greenfield: run `supabase-setup.sql`. Existing projects: run `supabase-migration-ai-status.sql` once.
- **Client:** Types and `recordingsRepo` read/write these fields on list/detail; **on insert** the app sets `ai_status = 'pending'`, `ai_error = null`, `ai_updated_at = now()` (see `insertLectureRecordingRow` / `lectureRecordingInsertPayload`).
- **UI:** Recording detail can show `ai_*` as **informational** (no polling, no enqueue, no cloud-job buttons). **Transcribe & summarize** still runs in the browser for cloud rows when the user clicks it; it only updates `transcript` / `summary_*` via `updateRecordingAi` � **it does not change `ai_status`**.

## Phase 2 (planned; not wired in default flow)

- Add **enqueue** API (and choose runtime: Supabase Edge Function vs existing Node server).
- Run a **real worker** that downloads audio, transcribes/summarizes, and updates `ai_*` + transcript fields.
- Frontend: optional **polling**, **retry cloud job**, **browser fallback** � and any **dev stub** only behind an explicit dev flag (not the default path).

## Longer-term notes

RLS stays as today; a worker must use **service role** (or an Edge Function with a server secret), never the anon key for cross-user writes.

Ordering when you implement Phase 2:

1. Enqueue route + worker that reads DB + Storage and updates the row (reuse server OpenAI helpers where possible).
2. Call enqueue once after insert (or use a DB webhook instead of a client call).
3. Add polling UI and optional retry that resets `ai_status` and re-enqueues.

Idempotency: if `ai_status = 'done'` and transcript is present, skip unless the user explicitly retries.
