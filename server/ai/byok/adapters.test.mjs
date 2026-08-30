import { afterEach, describe, expect, it, vi } from 'vitest'

import { byokSummarize } from './adapters.mjs'

function mockChatResponse(summary) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(summary) } }],
        }),
    })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BYOK summary response contract', () => {
  it('maps the shared multilingual prompt fields to the legacy client response', async () => {
    mockChatResponse({
      source_summary: 'English summary',
      translated_summary: '中文摘要',
    })

    await expect(byokSummarize('openai', 'Lecture transcript', 'Course', 'Title', 'key')).resolves.toEqual({
      summaryEn: 'English summary',
      summaryZh: '中文摘要',
    })
  })

  it('accepts legacy fields for provider responses generated from an older prompt', async () => {
    mockChatResponse({
      summary_en: 'English summary',
      summary_zh: '中文摘要',
    })

    await expect(byokSummarize('qwen', 'Lecture transcript', 'Course', 'Title', 'key')).resolves.toEqual({
      summaryEn: 'English summary',
      summaryZh: '中文摘要',
    })
  })
})
