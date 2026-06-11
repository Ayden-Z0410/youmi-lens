/**
 * Youmi Watch — provider snapshot collectors v1 (Phase 5D-1).
 *
 * Admin-triggered, self-contained probes that write real rows to
 * public.watch_provider_snapshots via the existing best-effort
 * recordWatchProviderSnapshot helper. NO external provider APIs are called:
 *   • supabase — timed read-only PostgREST HEAD/count probe on watch_config
 *     using the existing service-role client.
 *   • railway — timed GET of our own deployed /api/health (self-health; the
 *     hosting status is "is the app reachable and ready").
 *
 * DESIGN CONTRACT
 *   • Best-effort: a probe failure writes an honest 'offline' snapshot; a
 *     MISSING capability (no client / no URL) skips — "cannot probe" must
 *     never masquerade as provider status. Nothing here throws to the caller.
 *   • Anti-spam: providers with a snapshot fresher than COOLDOWN_MS are
 *     skipped, and an in-flight guard shares one run between concurrent calls.
 *   • Append-only: never deletes or updates old snapshots.
 *   • Sanitized: rows hold derived scalars + tiny fixed descriptors only —
 *     never keys, URLs, env values, headers, raw responses, or user data.
 */
import { getAdminClient } from './betaGate.mjs'
import { recordWatchProviderSnapshot } from './watchLedger.mjs'
import { requireWatchAdmin } from './adminWatchAccess.mjs'

export const SNAPSHOT_COOLDOWN_MS = 5 * 60 * 1000
export const LATENCY_DEGRADED_MS = 1500
export const HEALTH_TIMEOUT_MS = 5000

/** Providers this v1 collector knows how to probe (no external APIs). */
export const SNAPSHOT_PROVIDERS = Object.freeze(['supabase', 'railway'])

/**
 * Resolve the URL for the self-health probe. Env-driven; never stored or
 * logged. Local/dev falls back to the server's own listen port.
 */
function defaultHealthUrl() {
  const explicit = process.env.YOUMI_SELF_HEALTH_URL?.trim()
  if (explicit) return explicit
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim()
  if (domain) return `https://${domain}/api/health`
  const port = Number(process.env.PORT || process.env.AI_SERVER_PORT || 3847)
  return `http://127.0.0.1:${port}/api/health`
}

/** Status from a successful probe: degraded when slow, operational otherwise. */
function statusForLatency(latencyMs, thresholdMs) {
  return latencyMs > thresholdMs ? 'degraded' : 'operational'
}

/**
 * Supabase self-probe: timed HEAD/count on public.watch_config (returns no row
 * data). Returns { skipped } | { row } — never throws.
 */
export async function probeSupabaseSnapshot({ getClient = getAdminClient, now = Date.now } = {}) {
  const db = getClient()
  if (!db) return { skipped: 'no_client' }

  const t0 = now()
  let ok = false
  try {
    const { error } = await db.from('watch_config').select('key', { count: 'exact', head: true })
    ok = !error
  } catch {
    ok = false
  }
  const latencyMs = Math.max(0, Math.round(now() - t0))
  return {
    row: {
      provider: 'supabase',
      status: ok ? statusForLatency(latencyMs, LATENCY_DEGRADED_MS) : 'offline',
      latency_ms: latencyMs,
      detail: 'PostgREST head-count probe',
      metadata: { probe: 'postgrest_head', target_table: 'watch_config', probe_ok: ok },
    },
  }
}

/**
 * Railway self-health probe: timed GET of our own /api/health with a short
 * timeout. Returns { skipped } | { row } — never throws. The URL is used for
 * the request only and never stored in the row.
 */
export async function probeRailwaySnapshot({
  // Late-bound so test stubs of globalThis.fetch are honored.
  fetchImpl = (...args) => globalThis.fetch(...args),
  healthUrl = defaultHealthUrl,
  timeoutMs = HEALTH_TIMEOUT_MS,
  now = Date.now,
} = {}) {
  const url = typeof healthUrl === 'function' ? healthUrl() : healthUrl
  if (!url) return { skipped: 'no_health_url' }

  const t0 = now()
  let httpStatus = null
  let ready = false
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetchImpl(url, { method: 'GET', signal: controller.signal })
    clearTimeout(timer)
    httpStatus = res.status
    if (res.ok) {
      // Minimal readiness check; the payload itself is never stored.
      try {
        const json = await res.json()
        ready = json?.ok === true
      } catch {
        ready = false
      }
    }
  } catch {
    ready = false // network error / timeout (httpStatus stays null)
  }
  const latencyMs = Math.max(0, Math.round(now() - t0))

  const metadata = { probe: 'self_health', probe_ok: ready }
  if (httpStatus != null) metadata.http_status = httpStatus
  return {
    row: {
      provider: 'railway',
      status: ready ? statusForLatency(latencyMs, LATENCY_DEGRADED_MS) : 'offline',
      latency_ms: latencyMs,
      detail: 'Application health probe',
      metadata,
    },
  }
}

/**
 * Latest snapshot age per provider (for the cooldown). Read-only; an error
 * just means "no cooldown info" and probing proceeds.
 */
async function freshProviders(db, providers, cooldownMs, now) {
  if (!db) return new Set()
  try {
    const cutoff = new Date(now() - cooldownMs).toISOString()
    const { data, error } = await db
      .from('watch_provider_snapshots')
      .select('provider,captured_at')
      .in('provider', providers)
      .gte('captured_at', cutoff)
      .limit(50)
    if (error || !Array.isArray(data)) return new Set()
    return new Set(data.map((r) => String(r.provider)))
  } catch {
    return new Set()
  }
}

/**
 * Build a snapshot refresher with injectable deps (tests) and an in-flight
 * guard: concurrent calls share one run. Returns a sanitized summary:
 *   { ok, refreshed: [provider...],
 *     skipped: [{ provider, reason }...], failed: [{ provider, reason }...] }
 */
export function createSnapshotRefresher({
  getClient = getAdminClient,
  record = recordWatchProviderSnapshot,
  // Late-bound so test stubs of globalThis.fetch are honored.
  fetchImpl = (...args) => globalThis.fetch(...args),
  healthUrl = defaultHealthUrl,
  cooldownMs = SNAPSHOT_COOLDOWN_MS,
  timeoutMs = HEALTH_TIMEOUT_MS,
  now = Date.now,
} = {}) {
  let inFlight = null

  async function runOnce() {
    const refreshed = []
    const skipped = []
    const failed = []

    const db = getClient()
    const fresh = await freshProviders(db, [...SNAPSHOT_PROVIDERS], cooldownMs, now)

    const probes = [
      ['supabase', () => probeSupabaseSnapshot({ getClient, now })],
      ['railway', () => probeRailwaySnapshot({ fetchImpl, healthUrl, timeoutMs, now })],
    ]

    for (const [provider, probe] of probes) {
      if (fresh.has(provider)) {
        skipped.push({ provider, reason: 'cooldown' })
        continue
      }
      const result = await probe()
      if (result.skipped) {
        skipped.push({ provider, reason: result.skipped })
        continue
      }
      const write = await record(result.row)
      if (write?.ok) refreshed.push(provider)
      else failed.push({ provider, reason: 'ledger_write_failed' })
    }

    return { ok: true, refreshed, skipped, failed }
  }

  return async function refreshSnapshots() {
    if (inFlight) return inFlight // share the in-flight run; no duplicate probes
    inFlight = runOnce()
      .catch((err) => {
        // Defensive: the summary itself must never throw or leak internals.
        console.warn(`[watchSnapshots] refresh threw: ${err?.message || 'unknown'}`)
        return { ok: false, refreshed: [], skipped: [], failed: [] }
      })
      .finally(() => {
        inFlight = null
      })
    return inFlight
  }
}

const defaultRefresher = createSnapshotRefresher()

/**
 * POST /api/admin/watch/snapshots/refresh — admin-gated snapshot refresh.
 * Response is the sanitized summary only (no URLs, no raw responses, no
 * error internals, no stack traces).
 */
export async function handleWatchSnapshotsRefresh(req, res) {
  const user = await requireWatchAdmin(req, res)
  if (!user) return
  const summary = await defaultRefresher()
  res.status(200).json(summary)
}
