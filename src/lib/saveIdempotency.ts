/**
 * Client-side idempotency for Stop & save: same recording UUID + user id should not
 * create duplicate rows or orphan uploads when retried (network jitter, double-click races).
 */

const PREFIX = 'lc:save:'
const TTL_MS = 2 * 60 * 60 * 1000 // 2h; stale entries ignored

type SaveLedgerEntry = {
  v: 1
  userId: string
  /** Highest completed step for this recording id */
  step: 'uploaded' | 'db_committed'
  storagePath: string
  updatedAt: number
}

function key(recordingId: string) {
  return `${PREFIX}${recordingId}`
}

function readEntry(recordingId: string): SaveLedgerEntry | null {
  try {
    const raw = sessionStorage.getItem(key(recordingId))
    if (!raw) return null
    const o = JSON.parse(raw) as SaveLedgerEntry
    if (o.v !== 1 || typeof o.userId !== 'string' || typeof o.storagePath !== 'string') return null
    if (Date.now() - o.updatedAt > TTL_MS) {
      sessionStorage.removeItem(key(recordingId))
      return null
    }
    return o
  } catch {
    return null
  }
}

export function ledgerGetCommittedPath(
  recordingId: string,
  userId: string,
): string | null {
  const e = readEntry(recordingId)
  if (!e || e.userId !== userId || e.step !== 'db_committed') return null
  return e.storagePath
}

export function ledgerMarkUploaded(
  recordingId: string,
  userId: string,
  storagePath: string,
): void {
  try {
    const cur = readEntry(recordingId)
    if (cur?.step === 'db_committed') return
    const next: SaveLedgerEntry = {
      v: 1,
      userId,
      step: 'uploaded',
      storagePath,
      updatedAt: Date.now(),
    }
    sessionStorage.setItem(key(recordingId), JSON.stringify(next))
  } catch {
    /* quota / private mode */
  }
}

export function ledgerMarkDbCommitted(recordingId: string, userId: string): void {
  try {
    const cur = readEntry(recordingId)
    const path = cur?.storagePath ?? ''
    if (!path) return
    const next: SaveLedgerEntry = {
      v: 1,
      userId,
      step: 'db_committed',
      storagePath: path,
      updatedAt: Date.now(),
    }
    sessionStorage.setItem(key(recordingId), JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

export function ledgerClear(recordingId: string): void {
  try {
    sessionStorage.removeItem(key(recordingId))
  } catch {
    /* ignore */
  }
}

/** Cross-tab hint: another tab may be saving the same logical session (best-effort). */
const LOCK_KEY = 'lc:save_lock'

export function tryAcquireTabSaveLock(recordingId: string): boolean {
  try {
    const raw = localStorage.getItem(LOCK_KEY)
    if (raw) {
      const o = JSON.parse(raw) as { id: string; t: number }
      if (o && typeof o.id === 'string' && typeof o.t === 'number') {
        if (Date.now() - o.t < 30_000 && o.id !== recordingId) {
          return false
        }
      }
    }
    localStorage.setItem(LOCK_KEY, JSON.stringify({ id: recordingId, t: Date.now() }))
    return true
  } catch {
    return true
  }
}

export function releaseTabSaveLock(recordingId: string): void {
  try {
    const raw = localStorage.getItem(LOCK_KEY)
    if (!raw) return
    const o = JSON.parse(raw) as { id: string }
    if (o?.id === recordingId) {
      localStorage.removeItem(LOCK_KEY)
    }
  } catch {
    /* ignore */
  }
}
