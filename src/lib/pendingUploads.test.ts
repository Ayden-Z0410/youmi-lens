import { describe, expect, it } from 'vitest'
import {
  sanitizeUploadErrorCategory,
  visiblePendingUploads,
  pendingStatusLabel,
  pendingStatusDetail,
  type PendingUploadMeta,
} from './pendingUploads'

function pending(over: Partial<PendingUploadMeta> = {}): PendingUploadMeta {
  return {
    id: 'rec-1', userId: 'user-A', course: 'CS 229', title: 'Backprop', durationSec: 1200,
    mime: 'audio/webm', lang: 'en-US', translateTarget: 'zh', createdAt: 1000, updatedAt: 1000,
    state: 'upload_failed', lastErrorCategory: 'network', attempts: 1, cloudUploaded: false, ...over,
  }
}

describe('pending upload recovery model (Phase 2D-2)', () => {
  it('sanitizes errors to safe categories (never raw text/secrets)', () => {
    expect(sanitizeUploadErrorCategory(new Error('Audio upload timed out'))).toBe('timeout')
    expect(sanitizeUploadErrorCategory(new Error('network error: fetch failed'))).toBe('network')
    expect(sanitizeUploadErrorCategory(new Error('Bucket not found'))).toBe('storage')
    expect(sanitizeUploadErrorCategory(new Error('503 gateway'))).toBe('server')
    expect(sanitizeUploadErrorCategory(new Error('Bearer sk_live_abc leaked'))).toBe('unknown')
  })

  it('shows only the current user’s pending uploads (cross-account isolation)', () => {
    const all = [pending({ id: 'a', userId: 'user-A' }), pending({ id: 'b', userId: 'user-B' })]
    const forA = visiblePendingUploads(all, 'user-A', new Set())
    expect(forA.map((p) => p.id)).toEqual(['a'])
    const forB = visiblePendingUploads(all, 'user-B', new Set())
    expect(forB.map((p) => p.id)).toEqual(['b'])
  })

  it('de-duplicates against cloud recordings (no duplicate row after a successful retry)', () => {
    const all = [pending({ id: 'a' }), pending({ id: 'b' })]
    // 'a' already exists in cloud (e.g. a prior retry uploaded it) → hide it
    const visible = visiblePendingUploads(all, 'user-A', new Set(['a']))
    expect(visible.map((p) => p.id)).toEqual(['b'])
  })

  it('orders newest-first for stable placement', () => {
    const all = [pending({ id: 'old', createdAt: 100 }), pending({ id: 'new', createdAt: 900 })]
    expect(visiblePendingUploads(all, 'user-A', new Set()).map((p) => p.id)).toEqual(['new', 'old'])
  })

  it('produces safe, clear status labels', () => {
    expect(pendingStatusLabel({ state: 'upload_failed' })).toMatch(/Retry required/)
    expect(pendingStatusLabel({ state: 'uploading' })).toBe('Uploading…')
    const detail = pendingStatusDetail({ state: 'upload_failed', lastErrorCategory: 'network' })
    expect(detail).toMatch(/safe on this device/)
    expect(detail).toMatch(/nothing needs to be re-recorded/)
    expect(detail).not.toMatch(/sk_|Bearer|token/i)
  })
})
