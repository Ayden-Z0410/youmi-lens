import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'vitest'

/**
 * Stage 4 Cloud Library migration — static contract guard.
 *
 * Pins the migration SQL against the frozen contract so a future edit cannot
 * quietly turn an additive, idempotent, staging-safe artifact into something
 * destructive, production-targeting, or freshness-corrupting. Every assertion
 * here protects a real invariant the migration's own comments commit to —
 * this is not a string-search test for its own sake.
 */

const sql = readFileSync(new URL('../supabase-migration-desktop-stage4-cloud-library.sql', import.meta.url), 'utf8')

describe('Stage 4 Cloud Library migration — static contract', () => {
  it('is transactional', () => {
    assert.match(sql, /begin;[\s\S]*commit;/i, 'migration must be transactional')
  })

  it('is additive — no DROP TABLE/COLUMN', () => {
    assert.doesNotMatch(sql, /\bdrop\s+(?:table|column)\b/i, 'migration must remain additive')
  })

  it('never fabricates freshness for legacy rows', () => {
    // An UPDATE here would be exactly the P0 incident shape: a migration
    // stamping every existing row with the DDL instant, which lets a
    // migration-time "now" beat a genuine older user edit in a client merge.
    assert.doesNotMatch(
      sql,
      /\bupdate\s+public\.(?:recordings|courses)\b/i,
      'migration must not fabricate freshness for legacy rows',
    )
  })

  it('never advances a field clock via a generic trigger', () => {
    // A generic trigger would incorrectly advance title/notes/marks freshness
    // on an unrelated transcript/AI update, corrupting every merge that reads
    // that clock.
    assert.doesNotMatch(sql, /\bcreate\s+trigger\b/i, 'field clocks must not be advanced by a generic trigger')
  })

  it('never broadens RLS', () => {
    assert.doesNotMatch(
      sql,
      /\b(?:create|alter)\s+policy\b|disable\s+row\s+level\s+security|\bgrant\s+/i,
      'migration must not touch RLS policies or grants',
    )
  })

  it('never names the production project ref', () => {
    // This is a schema artifact, not a connection script — it has no reason to
    // know which project it runs against. Naming the production ref anywhere
    // in it is a sign the file was copied from, or aimed at, the wrong target.
    assert.doesNotMatch(sql, /lbwsrnjbiayepshrdult/, 'migration must not reference the production project ref')
  })

  it('pins the exact recordings.* column contract', () => {
    const recordings = {
      course_id: 'uuid null',
      updated_at: 'timestamptz not null default now\\(\\)',
      deleted_at: 'timestamptz null',
      deletion_updated_at: 'timestamptz null',
      title_updated_at: 'timestamptz null',
      notes: 'text null',
      notes_updated_at: 'timestamptz null',
      marked_timestamps: "jsonb null default '\\[\\]'::jsonb",
      marks_updated_at: 'timestamptz null',
    }
    const recordingsBlock = sql.match(/alter table public\.recordings([\s\S]*?);/i)?.[1] ?? ''
    for (const [column, definition] of Object.entries(recordings)) {
      assert.match(
        recordingsBlock,
        new RegExp(`add column if not exists ${column}\\s+${definition}`, 'i'),
        `recordings.${column} contract missing`,
      )
    }
  })

  it('pins the exact courses.* column contract', () => {
    const coursesBlock = sql.match(/alter table public\.courses([\s\S]*?);/i)?.[1] ?? ''
    for (const column of ['deleted_at', 'deletion_updated_at']) {
      assert.match(
        coursesBlock,
        new RegExp(`add column if not exists ${column}\\s+timestamptz null`, 'i'),
        `courses.${column} contract missing`,
      )
    }
    for (const column of ['icon', 'tint', 'accent']) {
      assert.match(
        coursesBlock,
        new RegExp(`add column if not exists ${column}\\s+text null`, 'i'),
        `courses.${column} contract missing`,
      )
    }
  })

  it('adds the deletion lookup indexes', () => {
    assert.match(sql, /recordings_user_deleted_at_idx/i, 'recordings deletion lookup index missing')
    assert.match(sql, /courses_user_deleted_at_idx/i, 'courses deletion lookup index missing')
  })

  it('keeps the Cloud Marks V1 shape explicit: JSONB number[], not a structured object', () => {
    assert.match(sql, /number\[\] of millisecond offsets/i, 'Cloud Marks V1 shape must stay explicit')
  })

  it('keeps marked_timestamps compatible with an explicit legacy NULL and an omitted-marks default', () => {
    assert.match(sql, /alter column marked_timestamps drop not null/i, 'explicit legacy NULL marks must remain readable')
    assert.match(
      sql,
      /alter column marked_timestamps set default '\[\]'::jsonb/i,
      'omitted marks must default to an empty array',
    )
  })
})
