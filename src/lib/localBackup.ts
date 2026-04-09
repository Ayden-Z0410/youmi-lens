import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { Recording } from '../types'
import type { RecordingWithBlob } from './db'

const FORMAT = 'lecture-companion-backup' as const
const VERSION = 1 as const

type ManifestRecording = Recording & { audioPath: string }

type Manifest = {
  format: typeof FORMAT
  version: typeof VERSION
  exportedAt: number
  recordings: ManifestRecording[]
}

function extFromMime(mime: string): string {
  const m = mime.toLowerCase()
  if (m.includes('webm')) return 'webm'
  if (m.includes('mp4') || m.includes('m4a')) return 'm4a'
  return 'bin'
}

export async function buildLocalBackupZip(rows: RecordingWithBlob[]): Promise<Blob> {
  const files: Record<string, Uint8Array> = {}
  const recordings: ManifestRecording[] = []

  for (const row of rows) {
    const ext = extFromMime(row.mime)
    const audioPath = `audio/${row.id}.${ext}`
    const ab = await row.audioBlob.arrayBuffer()
    files[audioPath] = new Uint8Array(ab)
    const { audioBlob: _drop, ...meta } = row
    void _drop
    recordings.push({ ...meta, audioPath })
  }

  const manifest: Manifest = {
    format: FORMAT,
    version: VERSION,
    exportedAt: Date.now(),
    recordings,
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest))

  const zipped = zipSync(files, { level: 6 })
  return new Blob([new Uint8Array(zipped)], { type: 'application/zip' })
}

function readManifest(unzipped: Record<string, Uint8Array>): Manifest {
  const raw = unzipped['manifest.json']
  if (!raw) throw new Error('Backup is missing manifest.json')
  const manifest = JSON.parse(strFromU8(raw)) as Manifest
  if (manifest.format !== FORMAT || manifest.version !== VERSION) {
    throw new Error('This file is not a Youmi Lens backup (wrong format or version).')
  }
  if (!Array.isArray(manifest.recordings)) {
    throw new Error('Invalid backup: recordings missing')
  }
  return manifest
}

export async function importLocalBackupZip(
  buf: ArrayBuffer,
  opts: {
    saveRow: (row: RecordingWithBlob) => Promise<void>
    exists: (id: string) => Promise<boolean>
    /** If true, replace existing rows with the same id. */
    overwrite: boolean
  },
): Promise<{ imported: number; skipped: number }> {
  const unzipped = unzipSync(new Uint8Array(buf))
  const manifest = readManifest(unzipped)

  let imported = 0
  let skipped = 0

  for (const r of manifest.recordings) {
    const { audioPath, ...meta } = r
    const exists = await opts.exists(meta.id)
    if (exists && !opts.overwrite) {
      skipped++
      continue
    }
    const data = unzipped[audioPath]
    if (!data?.length) {
      skipped++
      continue
    }
    const blob = new Blob([new Uint8Array(data)], { type: meta.mime || 'application/octet-stream' })
    await opts.saveRow({ ...meta, audioBlob: blob })
    imported++
  }

  return { imported, skipped }
}
