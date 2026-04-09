/**
 * Youmi AI live captions: upload each browser slice to Storage, then server transcribes via signed URL
 * (DashScope Paraformer, same ASR stack as after-class; separate route from process-recording).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getAiApiBase } from './ai/apiBase'
import { youmiLiveLog, youmiLiveSafeUrlParts, youmiLiveSummarizeJsonBody } from './youmiLiveDebug'

const BUCKET = 'lecture-audio'

export async function transcribeHostedLiveCaptionChunk(opts: {
  supabase: SupabaseClient
  accessToken: string
  userId: string
  sessionId: string
  chunkIndex: number
  blob: Blob
  mime: string
  filename: string
}): Promise<string> {
  const apiBase = getAiApiBase()
  const ext = opts.filename.includes('.') ? opts.filename.split('.').pop() || 'webm' : 'webm'
  const path = `${opts.userId}/live-captions/${opts.sessionId}/${String(opts.chunkIndex).padStart(6, '0')}.${ext}`

  youmiLiveLog('B', 'live chunk client: starting upload', {
    chunkIndex: opts.chunkIndex,
    bytes: opts.blob.size,
    mime: opts.mime,
    apiBase,
    storagePathSuffix: path.slice(-48),
  })

  const { error: upErr } = await opts.supabase.storage.from(BUCKET).upload(path, opts.blob, {
    contentType: opts.mime || `audio/${ext}`,
    upsert: true,
  })
  if (upErr) {
    youmiLiveLog('C', 'storage upload failed', { chunkIndex: opts.chunkIndex, err: upErr.message })
    throw new Error(upErr.message)
  }
  youmiLiveLog('C', 'storage upload ok', { chunkIndex: opts.chunkIndex })

  const { data: signed, error: signErr } = await opts.supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 600)

  if (signErr || !signed?.signedUrl) {
    await opts.supabase.storage.from(BUCKET).remove([path]).catch(() => undefined)
    youmiLiveLog('C', 'signed URL failed', {
      chunkIndex: opts.chunkIndex,
      err: signErr?.message ?? 'no url',
    })
    throw new Error(signErr?.message || 'Could not sign URL for live caption')
  }
  const safe = youmiLiveSafeUrlParts(signed.signedUrl)
  youmiLiveLog('C', 'signed URL ok (host+path only)', {
    chunkIndex: opts.chunkIndex,
    host: safe?.host ?? '?',
    path: safe?.path ?? '?',
  })

  try {
    try {
      const endpoint = `${apiBase}/live-transcribe-url`
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.accessToken}`,
        },
        body: JSON.stringify({ url: signed.signedUrl }),
      })
      const resText = await res.text()
      let parsed: { text?: string; error?: string } = {}
      try {
        parsed = JSON.parse(resText) as { text?: string; error?: string }
      } catch {
        parsed = {}
      }
      youmiLiveLog('srv', 'live-transcribe-url response', {
        chunkIndex: opts.chunkIndex,
        status: res.status,
        bodySummary: youmiLiveSummarizeJsonBody(parsed),
      })
      if (!res.ok) {
        throw new Error(parsed.error || 'LIVE_TRANSCRIBE_FAILED')
      }
      const text = (parsed.text ?? '').trim()
      if (!text.length) {
        youmiLiveLog('D', 'primary text empty after 200 from live-transcribe-url', {
          chunkIndex: opts.chunkIndex,
        })
      }
      return text
    } catch (first) {
      youmiLiveLog('B', 'fallback POST /api/transcribe (multipart)', {
        chunkIndex: opts.chunkIndex,
        reason: first instanceof Error ? first.message : String(first),
      })
      const form = new FormData()
      form.append('file', opts.blob, opts.filename)
      form.append('filename', opts.filename)
      const res2 = await fetch(`${apiBase}/transcribe`, { method: 'POST', body: form })
      const t2 = await res2.text()
      let p2: { text?: string; error?: string } = {}
      try {
        p2 = JSON.parse(t2) as { text?: string; error?: string }
      } catch {
        p2 = {}
      }
      youmiLiveLog('srv', '/api/transcribe fallback response', {
        chunkIndex: opts.chunkIndex,
        status: res2.status,
        bodySummary: youmiLiveSummarizeJsonBody(p2),
      })
      if (!res2.ok) {
        throw new Error(p2.error || (first instanceof Error ? first.message : 'LIVE_TRANSCRIBE_FAILED'))
      }
      const text2 = (p2.text ?? '').trim()
      if (!text2.length) {
        youmiLiveLog('D', 'primary text empty after /api/transcribe fallback', {
          chunkIndex: opts.chunkIndex,
        })
      }
      return text2
    }
  } finally {
    await opts.supabase.storage.from(BUCKET).remove([path]).catch(() => undefined)
  }
}
