/** Client-side "recently deleted" registry for Supabase-backed lectures (no server migration). */

export type CloudTrashedMeta = { trashedAt: number; title: string; course: string }

function storageKey(userId: string): string {
  return `yl_cloud_lecture_trash_v1:${userId}`
}

function isMeta(x: unknown): x is CloudTrashedMeta {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return typeof o.trashedAt === 'number' && typeof o.title === 'string' && typeof o.course === 'string'
}

export function loadCloudTrashRegistry(userId: string): Record<string, CloudTrashedMeta> {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return {}
    const p = JSON.parse(raw) as unknown
    if (!p || typeof p !== 'object') return {}
    const out: Record<string, CloudTrashedMeta> = {}
    for (const [id, v] of Object.entries(p as Record<string, unknown>)) {
      if (typeof id !== 'string' || !isMeta(v)) continue
      out[id] = v
    }
    return out
  } catch {
    return {}
  }
}

export function saveCloudTrashRegistry(userId: string, reg: Record<string, CloudTrashedMeta>): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(reg))
  } catch {
    /* quota / private mode */
  }
}
