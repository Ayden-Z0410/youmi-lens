/**
 * Youmi Watch — internal write helpers (Phase 2).
 *
 * Best-effort, server-only helpers that append rows to the Phase 1 watch_*
 * tables using the service-role Supabase client (which bypasses RLS). These are
 * the future write-path for the internal cost/usage ledger and provider
 * snapshots.
 *
 * DESIGN CONTRACT
 *   • Server-only. Never import from the frontend / browser bundle.
 *   • Best-effort: by default these never throw to the caller. A failed write
 *     returns { ok:false, error } and logs a concise warning — it must never
 *     break the user-facing operation it is attached to.
 *   • No provider secrets, no external API calls.
 *   • All caller-supplied `metadata` is scrubbed before insert (see
 *     scrubMetadata) so keys/tokens/transcripts/large payloads can never land
 *     in the database.
 *
 * NOTE: No existing call site is wired to these helpers yet (Phase 2 is the
 * helpers + tests only).
 */
import { getAdminClient } from './betaGate.mjs'
import { estimateCostUsd, normalizeProvider, normalizeUnit, round6 } from './watchPricing.mjs'

// Mirror the watch_* CHECK constraints so we never build a row the DB rejects.
const VALID_COST_STATUS = new Set(['recorded', 'reconciled', 'failed'])
const VALID_COST_SOURCE = new Set(['internal', 'provider', 'reconciled'])
const VALID_SNAPSHOT_STATUS = new Set([
  'operational',
  'degraded',
  'offline',
  'warning',
  'unknown',
])

// Partial UNIQUE index from supabase-watch-idempotency-key.sql. A 23505 on this
// specific constraint means the logical event was already recorded → safe dup.
const IDEMPOTENCY_CONSTRAINT = 'uq_watch_cost_events_idempotency_key'

// Postgres unique-violation error code.
const PG_UNIQUE_VIOLATION = '23505'

// ── metadata scrubbing ──────────────────────────────────────────────────────

/** Keys that may carry secrets or oversized/sensitive content — always dropped. */
const SENSITIVE_KEY =
  /(key|secret|token|authorization|auth|password|passwd|pass|bearer|credential|cookie|session|signature|sign|transcript|audio|payload|body|raw|prompt|content|text)/i

const MAX_STRING_LEN = 256 // longer strings are dropped (possible transcript / payload)
const MAX_KEYS = 24
const MAX_NESTED_KEYS = 12
const MAX_NESTED_BYTES = 512
const MAX_TOTAL_BYTES = 2048

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function scrubScalar(v) {
  if (v === null) return null
  const t = typeof v
  if (t === 'number') return Number.isFinite(v) ? v : undefined
  if (t === 'boolean') return v
  if (t === 'string') return v.length <= MAX_STRING_LEN ? v : undefined
  return undefined
}

function scrubValue(v) {
  const scalar = scrubScalar(v)
  if (scalar !== undefined || v === null) return scalar

  if (Array.isArray(v)) {
    const arr = []
    for (const item of v) {
      const s = scrubScalar(item)
      if (s !== undefined) arr.push(s)
      if (arr.length >= MAX_NESTED_KEYS) break
    }
    if (arr.length === 0) return undefined
    return safeBytes(arr) <= MAX_NESTED_BYTES ? arr : undefined
  }

  if (isPlainObject(v)) {
    const nested = {}
    let n = 0
    for (const [k, val] of Object.entries(v)) {
      if (n >= MAX_NESTED_KEYS) break
      if (SENSITIVE_KEY.test(k)) continue
      const s = scrubScalar(val) // one level deep only — no deep nesting
      if (s === undefined) continue
      nested[k] = s
      n++
    }
    if (Object.keys(nested).length === 0) return undefined
    return safeBytes(nested) <= MAX_NESTED_BYTES ? nested : undefined
  }

  return undefined // functions, bigint, symbol, undefined
}

function safeBytes(v) {
  try {
    return JSON.stringify(v)?.length ?? Infinity
  } catch {
    return Infinity
  }
}

/**
 * Return a small, non-secret copy of `metadata` safe to persist, or null.
 * Drops sensitive keys, oversized strings, deep nesting, and anything that
 * pushes the object past a small size budget. Exported for tests.
 */
export function scrubMetadata(metadata) {
  if (!isPlainObject(metadata)) return null
  const out = {}
  let keys = 0
  for (const [k, v] of Object.entries(metadata)) {
    if (keys >= MAX_KEYS) break
    if (SENSITIVE_KEY.test(k)) continue
    const cleaned = scrubValue(v)
    if (cleaned === undefined) continue
    out[k] = cleaned
    keys++
  }
  // Final total-size guard: drop most-recently-added keys until under budget.
  let entries = Object.entries(out)
  while (entries.length > 0 && safeBytes(Object.fromEntries(entries)) > MAX_TOTAL_BYTES) {
    entries = entries.slice(0, -1)
  }
  const result = Object.fromEntries(entries)
  return Object.keys(result).length > 0 ? result : null
}

// ── shared helpers ──────────────────────────────────────────────────────────

function numOrNull(v) {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function intOrNull(v) {
  const n = numOrNull(v)
  return n == null ? null : Math.round(n)
}

function toIso(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString()
  if (typeof v === 'string' && v.trim()) return v
  return undefined
}

// ── write helpers ───────────────────────────────────────────────────────────

/**
 * Append a row to public.watch_cost_events (the internal cost/usage ledger).
 * Best-effort; never throws. If `estimated_cost_usd` is omitted it is derived
 * from watchPricing. Returns { ok:true, id } or { ok:false, error }.
 *
 * Pass an optional `idempotency_key` (any stable, unique-per-logical-event
 * string, e.g. `deepgram:live:<sessionId>`) to make the write durably
 * exactly-once: a unique-violation on that key is treated as a SAFE duplicate
 * and returns `{ ok:true, duplicate:true, id:null }` rather than an error.
 * Events without a key behave exactly as before.
 *
 * @param {{
 *   provider: string, event_type: string,
 *   user_id?: string|null, recording_id?: string|null,
 *   quantity?: number, unit: string,
 *   estimated_cost_usd?: number, status?: string, source?: string,
 *   metadata?: object|null, occurred_at?: string|Date,
 *   idempotency_key?: string|null
 * }} event
 */
export async function recordWatchCostEvent(input) {
  const event = input && typeof input === 'object' ? input : {}
  const provider = normalizeProvider(event.provider)
  if (!provider) return { ok: false, error: 'invalid_provider' }

  const eventType =
    typeof event.event_type === 'string' ? event.event_type.trim() : ''
  if (!eventType) return { ok: false, error: 'invalid_event_type' }

  const unit = normalizeUnit(event.unit)
  if (!unit) return { ok: false, error: 'invalid_unit' }

  const quantity = Number(event.quantity)
  const qty = Number.isFinite(quantity) ? quantity : 0

  const providedCost = numOrNull(event.estimated_cost_usd)
  const estimated =
    providedCost != null
      ? round6(providedCost)
      : estimateCostUsd({ provider, unit, quantity: qty, metadata: event.metadata })

  const row = {
    provider,
    event_type: eventType,
    user_id: event.user_id ?? null,
    recording_id: event.recording_id ?? null,
    quantity: qty,
    unit,
    estimated_cost_usd: estimated,
    status: VALID_COST_STATUS.has(event.status) ? event.status : 'recorded',
    source: VALID_COST_SOURCE.has(event.source) ? event.source : 'internal',
    metadata: scrubMetadata(event.metadata),
  }
  const occurredAt = toIso(event.occurred_at)
  if (occurredAt) row.occurred_at = occurredAt

  // Optional durable idempotency. Only set the column when a non-empty key is
  // given; absent → NULL, which the partial unique index ignores (legacy
  // behavior unchanged). When set, a unique-violation is a safe duplicate.
  const idempotencyKey =
    typeof event.idempotency_key === 'string' && event.idempotency_key.trim()
      ? event.idempotency_key.trim()
      : null
  if (idempotencyKey) row.idempotency_key = idempotencyKey

  return insertRow(
    'watch_cost_events',
    row,
    idempotencyKey ? { dupeConstraint: IDEMPOTENCY_CONSTRAINT } : undefined,
  )
}

/**
 * Append a row to public.watch_provider_snapshots. Best-effort; never throws.
 * Returns { ok:true, id } or { ok:false, error }.
 *
 * @param {{
 *   provider: string, status: string,
 *   latency_ms?: number, health_pct?: number,
 *   usage_value?: number, usage_unit?: string, quota_used_pct?: number,
 *   estimated_cost_usd?: number, detail?: string,
 *   metadata?: object|null, captured_at?: string|Date
 * }} snapshot
 */
export async function recordWatchProviderSnapshot(input) {
  const snapshot = input && typeof input === 'object' ? input : {}
  const provider = normalizeProvider(snapshot.provider)
  if (!provider) return { ok: false, error: 'invalid_provider' }

  const status =
    typeof snapshot.status === 'string' ? snapshot.status.trim().toLowerCase() : ''
  if (!VALID_SNAPSHOT_STATUS.has(status)) return { ok: false, error: 'invalid_status' }

  const cost = numOrNull(snapshot.estimated_cost_usd)
  const usageUnit =
    snapshot.usage_unit != null ? normalizeUnit(snapshot.usage_unit) : null

  const row = {
    provider,
    status,
    latency_ms: intOrNull(snapshot.latency_ms),
    health_pct: numOrNull(snapshot.health_pct),
    usage_value: numOrNull(snapshot.usage_value),
    usage_unit: usageUnit,
    quota_used_pct: numOrNull(snapshot.quota_used_pct),
    estimated_cost_usd: cost == null ? null : round6(cost),
    detail:
      typeof snapshot.detail === 'string' ? snapshot.detail.slice(0, 500) : null,
    metadata: scrubMetadata(snapshot.metadata),
  }
  const capturedAt = toIso(snapshot.captured_at)
  if (capturedAt) row.captured_at = capturedAt

  return insertRow('watch_provider_snapshots', row)
}

/**
 * Shared best-effort insert returning the new id. Never throws.
 *
 * NOTE on idempotency: the idempotency index is PARTIAL
 * (WHERE idempotency_key IS NOT NULL), so PostgREST `upsert`/`on_conflict`
 * cannot target it (it can't express the index predicate, and Postgres rejects
 * an ON CONFLICT that doesn't match a full constraint). The safe pattern is a
 * plain INSERT, then narrowly interpret a unique-violation (23505) on THIS
 * constraint as a duplicate. `opts.dupeConstraint` opts a caller into that.
 */
async function insertRow(table, row, opts = {}) {
  const db = getAdminClient()
  if (!db) {
    console.warn(`[watchLedger] ${table}: no service-role client (skipped)`)
    return { ok: false, error: 'no_admin_client' }
  }
  try {
    const { data, error } = await db.from(table).insert(row).select('id').single()
    if (error) {
      // Narrow duplicate handling: only a 23505 on the caller's specific
      // idempotency constraint counts as a safe duplicate — any other unique
      // violation (or error) is still a real failure.
      if (
        opts.dupeConstraint &&
        error.code === PG_UNIQUE_VIOLATION &&
        String(error.message || '').includes(opts.dupeConstraint)
      ) {
        console.warn(`[watchLedger] ${table} duplicate idempotency_key — already recorded (safe)`)
        return { ok: true, duplicate: true, id: null }
      }
      console.warn(`[watchLedger] ${table} insert failed: ${error.message || 'unknown'}`)
      return { ok: false, error: error.message || 'insert_failed' }
    }
    return { ok: true, id: data?.id }
  } catch (e) {
    console.warn(`[watchLedger] ${table} insert threw: ${e?.message || 'unknown'}`)
    return { ok: false, error: e?.message || 'threw' }
  }
}
