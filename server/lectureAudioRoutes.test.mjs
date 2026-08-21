/**
 * Cloud Library — authenticated audio retrieval endpoint.
 *
 * Static/wiring guards (the live end-to-end behaviour is proven separately
 * against staging by the second-client simulation). These pin the security
 * contract in source so it cannot silently regress.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { handleGetLectureAudio } from './lectureAudioRoutes.mjs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const src = read('./lectureAudioRoutes.mjs')
const index = read('./index.mjs')

describe('audio retrieval — wiring', () => {
  it('exposes a GET route scoped under /api/lectures/:id/audio', () => {
    expect(index).toMatch(/app\.get\('\/api\/lectures\/:id\/audio'/)
    expect(index).toContain("import { handleGetLectureAudio } from './lectureAudioRoutes.mjs'")
    expect(typeof handleGetLectureAudio).toBe('function')
  })
})

describe('audio retrieval — upload contract consistency (A10)', () => {
  const upload = read('./uploadAudio.mjs')

  it('upload writes and retrieval reads the same canonical storage_path field', () => {
    expect(upload).toMatch(/storage_path:\s*storagePath/)
    expect(src).toMatch(/createSignedUrl\(row\.storage_path, SIGNED_URL_TTL_SEC\)/)
  })

  it('upload and retrieval target the same lecture-audio storage bucket', () => {
    expect(upload).toMatch(/const BUCKET = 'lecture-audio'/)
    expect(src).toMatch(/const BUCKET = 'lecture-audio'/)
  })
})

describe('audio retrieval — security contract', () => {
  it('requires a verified user (verifyJwt) and 401s otherwise', () => {
    expect(src).toMatch(/const user = await verifyJwt\(token\)/)
    expect(src).toMatch(/if \(!user\)[\s\S]{0,80}status\(401\)/)
  })

  it('scopes the lookup to the authenticated user_id (ownership gate)', () => {
    expect(src).toMatch(/\.eq\('id', recordingId\)\s*\n\s*\.eq\('user_id', userId\)/)
  })

  it('returns 404 for a missing OR non-owned row (no existence leak)', () => {
    expect(src).toMatch(/if \(!row\)[\s\S]{0,80}status\(404\)/)
    // The same 404 covers "owned by someone else" because of the user_id filter.
  })

  it('returns a SHORT-LIVED signed URL, never the service key', () => {
    expect(src).toMatch(/createSignedUrl\(row\.storage_path, SIGNED_URL_TTL_SEC\)/)
    const ttl = Number(src.match(/SIGNED_URL_TTL_SEC = Number\([^)]*\|\| (\d+)\)/)[1])
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(3600) // short-lived
    // The response body must not contain the service-role key.
    const responseBlock = src.slice(src.indexOf('return res.status(200)'))
    expect(responseBlock).not.toMatch(/SERVICE_ROLE|\bSEC\b/)
  })

  it('rejects a lecture with no cloud audio distinctly (409, not a fake URL)', () => {
    expect(src).toMatch(/if \(!row\.storage_path\)[\s\S]{0,200}status\(409\)/)
  })

  it('guards the id against path traversal / junk', () => {
    expect(src).toMatch(/\/\^\[0-9a-fA-F-\]\{8,64\}\$\//)
    expect(src).toMatch(/normalizeLectureId/)
  })

  it('accepts both "lecture_<uuid>" and bare "<uuid>" forms', () => {
    expect(src).toMatch(/startsWith\('lecture_'\)/)
  })
})
