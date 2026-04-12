import type { Recording, RecordingDetail } from '../types'

const DB_NAME = 'lecture-companion'
const DB_VERSION = 2
const STORE = 'recordings'

export type RecordingWithBlob = Recording & { audioBlob: Blob }

type Row = RecordingWithBlob

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
  })
}

export async function saveRecordingLocal(row: RecordingWithBlob): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(STORE).put(row as Row)
  })
}

export async function updateRecordingLocal(
  id: string,
  patch: Partial<
    Pick<
      Recording,
      'transcript' | 'transcriptRaw' | 'summaryEn' | 'summaryZh' | 'liveTranscript' | 'liveTranscriptRaw'
    >
  >,
): Promise<void> {
  const existing = await getRecordingWithBlob(id)
  if (!existing) throw new Error('Recording not found')
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    const next: Row = { ...existing, ...patch }
    tx.objectStore(STORE).put(next)
  })
}

export async function getRecordingWithBlob(id: string): Promise<RecordingWithBlob | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    req.onsuccess = () => resolve((req.result as Row | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function getRecordingDetailLocal(id: string): Promise<RecordingDetail | null> {
  const row = await getRecordingWithBlob(id)
  if (!row) return null
  return {
    id: row.id,
    course: row.course,
    title: row.title,
    createdAt: row.createdAt,
    durationSec: row.durationSec,
    mime: row.mime,
    transcript: row.transcript,
    transcriptRaw: row.transcriptRaw,
    summaryEn: row.summaryEn,
    summaryZh: row.summaryZh,
    liveTranscript: row.liveTranscript,
    liveTranscriptRaw: row.liveTranscriptRaw,
    audioUrl: URL.createObjectURL(row.audioBlob),
    storagePath: id,
  }
}

/** Full rows including audio (for backup export). */
export async function getAllRecordingsLocalWithBlobs(): Promise<RecordingWithBlob[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve((req.result as Row[]) ?? [])
    req.onerror = () => reject(req.error)
  })
}

export async function listRecordingsLocal(): Promise<Recording[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => {
      const rows = (req.result as Row[]).map((r) => {
        const { audioBlob: _b, ...meta } = r
        void _b
        return meta
      })
      rows.sort((a, b) => b.createdAt - a.createdAt)
      resolve(rows)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function deleteRecordingLocal(id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(STORE).delete(id)
  })
}
