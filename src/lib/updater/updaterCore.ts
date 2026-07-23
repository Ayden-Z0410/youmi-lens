/**
 * Desktop in-app updater — pure logic (Phase 2E). Framework-free so it is fully
 * unit-testable without Tauri. The React hook (useUpdater) wraps the official
 * Tauri v2 @tauri-apps/plugin-updater + @tauri-apps/plugin-process around this.
 *
 * Security/product invariants encoded here:
 *   - Downgrade prevention: an update is offered only for a STRICTLY newer semver.
 *   - Recording safety: install/restart is BLOCKED while a lecture is recording,
 *     paused-but-unfinished, or a Stop&Save persist is in flight — an in-memory
 *     recording must never be sacrificed to an update.
 *   - Errors surfaced to users are sanitized (no URLs, tokens, or signatures).
 */

// ── Semantic version comparison ──────────────────────────────────────────────

/** Parse "1.2.3" (ignoring any -prerelease/+build) to [major, minor, patch]. */
export function parseSemver(v: string): [number, number, number] | null {
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? ''))
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** -1 if a<b, 0 if equal, 1 if a>b. Unparseable versions sort as lowest. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa && !pb) return 0
  if (!pa) return -1
  if (!pb) return 1
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1
    if (pa[i] > pb[i]) return 1
  }
  return 0
}

/** True only when `latest` is STRICTLY newer than `current` (prevents downgrade). */
export function isNewerVersion(latest: string, current: string): boolean {
  return compareSemver(latest, current) === 1
}

// ── Platform / architecture → Tauri updater manifest target key ───────────────

export type UpdaterTargetKey =
  | 'darwin-aarch64'
  | 'darwin-x86_64'
  | 'windows-x86_64'
  | 'windows-aarch64'
  | 'linux-x86_64'

/**
 * Map Tauri OS/arch (from @tauri-apps/plugin-os platform()/arch()) to the target
 * key used in the static update manifest's `platforms` map. Returns null for an
 * unsupported combination so we never point a Mac user at a Windows package.
 */
export function tauriTargetFor(platform: string, arch: string): UpdaterTargetKey | null {
  const p = platform.toLowerCase()
  const a = arch.toLowerCase()
  if (p === 'macos' || p === 'darwin') {
    if (a === 'aarch64' || a === 'arm64') return 'darwin-aarch64'
    if (a === 'x86_64' || a === 'x64') return 'darwin-x86_64'
    return null
  }
  if (p === 'windows') {
    if (a === 'x86_64' || a === 'x64') return 'windows-x86_64'
    if (a === 'aarch64' || a === 'arm64') return 'windows-aarch64'
    return null
  }
  if (p === 'linux' && (a === 'x86_64' || a === 'x64')) return 'linux-x86_64'
  return null
}

/** Shape of one entry in a static Tauri v2 update manifest. */
export interface UpdateManifest {
  version: string
  notes?: string
  pub_date?: string
  platforms: Record<string, { signature: string; url: string }>
}

/**
 * Pure selection: given a manifest, the installed version, and the running
 * target, decide whether an update applies and pick the correct signed artifact.
 * Never crosses platforms; never offers same/older versions; requires a signature.
 */
export function selectUpdate(
  manifest: UpdateManifest,
  currentVersion: string,
  target: UpdaterTargetKey | null,
): { available: false; reason: string } | { available: true; version: string; notes?: string; url: string; signature: string } {
  if (!manifest || !manifest.version || !manifest.platforms) {
    return { available: false, reason: 'no_manifest' }
  }
  if (!target) return { available: false, reason: 'unsupported_platform' }
  if (!isNewerVersion(manifest.version, currentVersion)) {
    return { available: false, reason: 'up_to_date' }
  }
  const entry = manifest.platforms[target]
  if (!entry || !entry.url) return { available: false, reason: 'no_artifact_for_platform' }
  if (!entry.signature) return { available: false, reason: 'missing_signature' }
  if (!/^https:\/\//i.test(entry.url)) return { available: false, reason: 'insecure_url' }
  return { available: true, version: manifest.version, notes: manifest.notes, url: entry.url, signature: entry.signature }
}

// ── Updater UI state ─────────────────────────────────────────────────────────

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'restart-required'
  | 'error'

export function updaterStatusLabel(status: UpdaterStatus): string {
  switch (status) {
    case 'checking':
      return 'Checking for updates…'
    case 'available':
      return 'Update available'
    case 'downloading':
      return 'Downloading update…'
    case 'ready':
      return 'Restart to update'
    case 'installing':
      return 'Installing update…'
    case 'restart-required':
      return 'Restart to finish update'
    case 'up-to-date':
      return 'You’re up to date'
    case 'error':
      return 'Update failed — Retry'
    default:
      return ''
  }
}

/** Only 'available'/'downloading'/'ready'/'error' surface the sidebar entry. */
export function updaterEntryVisible(status: UpdaterStatus): boolean {
  return status === 'available' || status === 'downloading' || status === 'ready' || status === 'error'
}

// ── Recording-safety gate (never sacrifice an in-memory recording) ────────────

export interface RecordingSafetyState {
  /** recorder.status: 'idle' | 'recording' | 'paused' */
  recorderStatus: 'idle' | 'recording' | 'paused'
  /** true while a Stop&Save (local persist / upload) is in flight */
  saveInFlight: boolean
}

/**
 * Whether it is safe to install + restart for an update right now. Blocks while a
 * lecture is recording, paused-but-unfinished, or being persisted — the update is
 * kept ready for later. (Durable pending uploads may continue after restart, so
 * they do not block; only live/in-memory capture does.)
 */
export function canInstallUpdate(rec: RecordingSafetyState): { ok: true } | { ok: false; reason: string } {
  if (rec.recorderStatus === 'recording') {
    return { ok: false, reason: 'A lecture is recording. Finish and save it before updating.' }
  }
  if (rec.recorderStatus === 'paused') {
    return { ok: false, reason: 'A paused recording isn’t saved yet. Finish and save it before updating.' }
  }
  if (rec.saveInFlight) {
    return { ok: false, reason: 'Your recording is still saving. The update will install once it finishes.' }
  }
  return { ok: true }
}

// ── Error sanitization ───────────────────────────────────────────────────────

/** Collapse any updater error to a safe user string (never URLs/tokens/signatures). */
export function sanitizeUpdaterError(err: unknown): string {
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase()
  if (/signature|verify|verification/.test(msg)) return 'The update could not be verified. Please try again later.'
  if (/network|fetch|timeout|timed out|offline|connection/.test(msg)) return 'Couldn’t reach the update service. Check your connection and try again.'
  if (/permission|denied|forbidden/.test(msg)) return 'The update could not be installed (permissions). Please reinstall from youmilens.com.'
  return 'Update failed. Please try again later.'
}
