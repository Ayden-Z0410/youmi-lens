import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'vitest'

test('terminal status and the complete multilingual summary pair persist atomically', () => {
  const source = readFileSync(new URL('./processRecording.mjs', import.meta.url), 'utf8')
  const donePayload = source.slice(source.indexOf('const donePayload = {'), source.indexOf('const doneColumns'))

  for (const field of ['source_summary', 'translated_summary', 'summary_en', 'summary_zh', "ai_status: 'done'"]) {
    assert.ok(donePayload.includes(field), `terminal payload must atomically include ${field}`)
  }
  assert.ok(
    source.indexOf('.update(donePayload)') < source.indexOf("jobLog('job_done'"),
    'job must not report done before the atomic summary update',
  )
  assert.ok(!source.includes('persistGenericSummaries'), 'generic summaries must not be written after done')
})
