import type { Recording } from '../types'

/** Which slice of the library the user is acting in (folder / unfiled / all). */
export type LibraryActiveScope =
  | { kind: 'all' }
  | { kind: 'unfiled' }
  | { kind: 'folder'; folderId: string }

export function getScopedRecordingIds(
  scope: LibraryActiveScope,
  recordings: Recording[],
  unfiledRecordings: Recording[],
  folderRecordingsMap: Record<string, Recording[]>,
): string[] {
  if (scope.kind === 'all') {
    return [...recordings].sort((a, b) => b.createdAt - a.createdAt).map((r) => r.id)
  }
  if (scope.kind === 'unfiled') {
    return unfiledRecordings.map((r) => r.id)
  }
  return (folderRecordingsMap[scope.folderId] ?? []).map((r) => r.id)
}

export function isRenamableFolderScope(scope: LibraryActiveScope): scope is { kind: 'folder'; folderId: string } {
  return scope.kind === 'folder'
}

export function folderNameConflict(
  trimmedName: string,
  folders: { id: string; name: string }[],
  exceptFolderId?: string,
): boolean {
  const t = trimmedName.toLowerCase()
  if (!t) return false
  return folders.some((f) => f.id !== exceptFolderId && f.name.trim().toLowerCase() === t)
}
