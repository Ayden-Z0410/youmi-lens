import { describe, expect, it } from 'vitest'

import {
  getLatestOverlaySentence,
  getOverlayLiveText,
  splitOverlayLiveSegments,
  tailForOverlay,
  trimOverlayDraft,
} from './overlayCaption'

describe('getLatestOverlaySentence', () => {
  it('returns "" for empty / whitespace-only input', () => {
    expect(getLatestOverlaySentence('', 120)).toBe('')
    expect(getLatestOverlaySentence('   ', 120)).toBe('')
  })

  it('returns the only sentence when text has just one', () => {
    expect(getLatestOverlaySentence('B-trees are common.', 120)).toBe('B-trees are common.')
  })

  it('returns ONLY the latest completed sentence when text ends on a period', () => {
    const full =
      'Today we will talk about databases. Indexing helps queries run faster. B-trees are common.'
    expect(getLatestOverlaySentence(full, 120)).toBe('B-trees are common.')
  })

  it('returns the in-progress fragment when text does not end on a boundary', () => {
    const partial = 'Today we will talk about databases. Indexing helps queries run'
    expect(getLatestOverlaySentence(partial, 120)).toBe('Indexing helps queries run')
  })

  it('returns ONLY the latest Chinese sentence after 。', () => {
    const zh = '今天我们讨论数据库。索引可以让查询更快。B树很常见。'
    expect(getLatestOverlaySentence(zh, 60)).toBe('B树很常见。')
  })

  it('treats ! ? ; : as boundaries (English) and ！？；： (Chinese)', () => {
    expect(getLatestOverlaySentence('First sentence! Second sentence?', 120)).toBe('Second sentence?')
    expect(getLatestOverlaySentence('A: B; C', 120)).toBe('C')
    expect(getLatestOverlaySentence('一句！二句？三句', 60)).toBe('三句')
  })

  it('returns the LATEST tail of a long sentence — not the beginning, no ellipsis', () => {
    const longSentence =
      'And so he actually has this web app that allows students to capture lectures in real time and understand what the professor is saying'
    const out = getLatestOverlaySentence(longSentence, 80)
    expect(out.length).toBeLessThanOrEqual(80)
    expect(out).not.toContain('…')
    expect(out).not.toContain('...')
    expect(out.endsWith('what the professor is saying')).toBe(true)
    expect(out).not.toContain('And so he actually')
    expect(out).toContain('the professor is saying')
  })

  it('long English tail prefers to start at a word boundary', () => {
    const longSentence =
      'And so he actually has this web app that allows students to capture lectures in real time and understand what the professor is saying'
    const out = getLatestOverlaySentence(longSentence, 80)
    const firstToken = out.split(' ')[0]
    expect(longSentence).toContain(' ' + firstToken)
  })

  it('long boundary-less stream returns latest tail without ellipsis', () => {
    const stream =
      'and then what we need to do is think about the product and how people actually use it in the classroom because students need it'
    const out = getLatestOverlaySentence(stream, 60)
    expect(out.length).toBeLessThanOrEqual(60)
    expect(out).not.toContain('…')
    expect(out).not.toContain('...')
    expect(out.endsWith('students need it')).toBe(true)
  })

  it('long Chinese sentence returns latest tail, character-clipped, no ellipsis', () => {
    const longZh =
      '今天我们讨论的内容包括索引B树哈希表事务隔离级别以及数据库系统当中的并发控制机制和恢复算法所以请大家集中注意力'
    const out = getLatestOverlaySentence(longZh, 30)
    expect(out.length).toBeLessThanOrEqual(30)
    expect(out).not.toContain('…')
    expect(out).not.toContain('...')
    expect(out.endsWith('请大家集中注意力')).toBe(true)
  })

  it('does not include earlier completed sentences', () => {
    const full =
      'Sentence one is here. Sentence two is here. Sentence three is here. Sentence four is here.'
    const out = getLatestOverlaySentence(full, 120)
    expect(out).toBe('Sentence four is here.')
    expect(out).not.toContain('Sentence one')
    expect(out).not.toContain('Sentence two')
    expect(out).not.toContain('Sentence three')
  })

  it('collapses whitespace and trims', () => {
    expect(getLatestOverlaySentence('   hello    world   ', 120)).toBe('hello world')
    expect(getLatestOverlaySentence('a.\n\n  b is the latest', 120)).toBe('b is the latest')
  })

  it('is stable across identical / repeated calls (no delta state)', () => {
    const text = 'Hello. World'
    expect(getLatestOverlaySentence(text, 120)).toBe('World')
    expect(getLatestOverlaySentence(text, 120)).toBe('World')
    expect(getLatestOverlaySentence(text, 120)).toBe('World')
  })
})

describe('tailForOverlay', () => {
  it('returns text unchanged when within budget', () => {
    expect(tailForOverlay('short text', 100)).toBe('short text')
  })

  it('returns trailing tail without ellipsis when over budget', () => {
    const text = 'one two three four five six seven eight nine ten eleven twelve thirteen'
    const out = tailForOverlay(text, 30)
    expect(out.length).toBeLessThanOrEqual(30)
    expect(out).not.toContain('…')
    expect(out).not.toContain('...')
    expect(out.endsWith('thirteen')).toBe(true)
  })

  it('skips a partial leading word when a space is near the start', () => {
    const text = 'zulu yankee xray whiskey alpha bravo charlie'
    const out = tailForOverlay(text, 18)
    expect(out.length).toBeLessThanOrEqual(18)
    expect(out).not.toContain('…')
    const firstToken = out.split(' ')[0]
    expect(text.split(' ').includes(firstToken)).toBe(true)
  })

  it('keeps mid-word start when the partial first word is the bulk of the budget', () => {
    const text = 'antidisestablishment'
    expect(tailForOverlay(text, 20)).toBe('antidisestablishment')
  })

  it('Chinese: clips by character without ellipsis', () => {
    const zh = '一二三四五六七八九十一二三四五六七八九十'
    const out = tailForOverlay(zh, 5)
    expect(out.length).toBe(5)
    expect(out).not.toContain('…')
    expect(out).toBe('六七八九十')
  })
})

describe('trimOverlayDraft', () => {
  it('returns "" for empty input', () => {
    expect(trimOverlayDraft('', 100)).toBe('')
  })

  it('returns text as-is when within budget', () => {
    expect(trimOverlayDraft('short draft', 100)).toBe('short draft')
  })

  it('returns trailing tail without ellipsis when over budget', () => {
    const long = 'one two three four five six seven eight nine ten eleven twelve'
    const out = trimOverlayDraft(long, 25)
    expect(out.length).toBeLessThanOrEqual(25)
    expect(out).not.toContain('…')
    expect(out).not.toContain('...')
    expect(out.endsWith('twelve')).toBe(true)
  })

  it('collapses whitespace', () => {
    expect(trimOverlayDraft('  multi   space  ', 100)).toBe('multi space')
  })
})

describe('getOverlayLiveText', () => {
  it('prefers the in-progress phrase over a stale completed sentence', () => {
    // Speaker has finished "Hello world." and is now saying "The second sentence".
    // Overlay must show only the in-progress phrase, never the stale "Hello world.".
    const out = getOverlayLiveText({
      committed: 'Hello world.',
      draft: 'The second sentence',
      maxChars: 60,
    })
    expect(out).toBe('The second sentence')
    expect(out).not.toContain('Hello world')
  })

  it('combines committed-tail (after last boundary) with the draft', () => {
    // Mid-sentence: committed already has "Hello world. The second", draft is " sentence".
    const out = getOverlayLiveText({
      committed: 'Hello world. The second',
      draft: 'sentence',
      maxChars: 60,
    })
    expect(out).toBe('The second sentence')
    expect(out).not.toContain('Hello world')
  })

  it('falls back to last completed sentence when both in-progress and draft are empty', () => {
    const out = getOverlayLiveText({
      committed: 'Hello world. The second sentence is done.',
      draft: '',
      maxChars: 60,
    })
    expect(out).toBe('The second sentence is done.')
  })

  it('shows draft alone when committed is empty', () => {
    expect(
      getOverlayLiveText({ committed: '', draft: 'starting to speak now', maxChars: 60 }),
    ).toBe('starting to speak now')
  })

  it('returns "" when both committed and draft are empty', () => {
    expect(getOverlayLiveText({ committed: '', draft: '', maxChars: 60 })).toBe('')
  })

  it('long live phrase returns the latest tail without ellipsis', () => {
    const out = getOverlayLiveText({
      committed:
        'And so he actually has this web app that allows students to capture lectures in real time and understand',
      draft: 'what the professor is saying',
      maxChars: 60,
    })
    expect(out.length).toBeLessThanOrEqual(60)
    expect(out).not.toContain('…')
    expect(out).not.toContain('...')
    expect(out.endsWith('what the professor is saying')).toBe(true)
  })

  it('Chinese: in-progress draft preferred over stale 。 sentence', () => {
    const out = getOverlayLiveText({
      committed: '今天我们讨论数据库。索引可以让查询更快。',
      draft: 'B树是非常常见的索引结构',
      maxChars: 30,
    })
    expect(out.length).toBeLessThanOrEqual(30)
    expect(out).not.toContain('…')
    expect(out).toBe('B树是非常常见的索引结构')
    expect(out).not.toContain('数据库')
  })

  it('never returns "..." or "…" anywhere in the output', () => {
    const samples = [
      { committed: 'Hello world. The second', draft: 'sentence', maxChars: 60 },
      { committed: 'a'.repeat(500), draft: '', maxChars: 60 },
      { committed: '', draft: 'b'.repeat(500), maxChars: 60 },
      { committed: '一'.repeat(200), draft: '二'.repeat(50), maxChars: 30 },
    ]
    for (const s of samples) {
      const out = getOverlayLiveText(s)
      expect(out).not.toContain('…')
      expect(out).not.toContain('...')
    }
  })

  // ── Natural left-to-right growth ───────────────────────────────────────
  // While the draft is shorter than maxChars, the helper must return it
  // verbatim from the BEGINNING — no tail-trim, no left-shift. The
  // overlay then reads as a normal subtitle that grows to the right.

  it('short English draft returns full text from the beginning', () => {
    expect(getOverlayLiveText({ committed: '', draft: 'Code', maxChars: 55 })).toBe('Code')
    expect(getOverlayLiveText({ committed: '', draft: 'Code and', maxChars: 55 })).toBe('Code and')
    expect(getOverlayLiveText({ committed: '', draft: 'Code and convert', maxChars: 55 })).toBe(
      'Code and convert',
    )
    expect(
      getOverlayLiveText({ committed: '', draft: 'Code and convert this file', maxChars: 55 }),
    ).toBe('Code and convert this file')
  })

  it('grows naturally to the right as draft is appended (no left-shift while under budget)', () => {
    const sequence = [
      'Code',
      'Code and',
      'Code and convert',
      'Code and convert this',
      'Code and convert this file',
    ]
    let prevOut = ''
    for (const draft of sequence) {
      const out = getOverlayLiveText({ committed: '', draft, maxChars: 55 })
      // Every step must START WITH the previous step's output — i.e. only
      // appended on the right, never trimmed on the left.
      if (prevOut) expect(out.startsWith(prevOut)).toBe(true)
      expect(out).toBe(draft)
      prevOut = out
    }
  })

  it('only tail-trims once the in-progress phrase exceeds maxChars', () => {
    const fits = 'Code and convert this file' // 26 chars
    const overflows =
      'Code and convert this file into a much longer phrase that goes on and on and on'
    expect(getOverlayLiveText({ committed: '', draft: fits, maxChars: 55 })).toBe(fits)
    const out = getOverlayLiveText({ committed: '', draft: overflows, maxChars: 55 })
    expect(out.length).toBeLessThanOrEqual(55)
    // Tail-trim happened — the START of the source is dropped, the END
    // is preserved.
    expect(overflows.endsWith(out.replace(/^…/, ''))).toBe(true)
    expect(out).not.toContain('…')
    expect(out).not.toContain('...')
  })

  it('short Chinese draft returns full text from the beginning', () => {
    expect(
      getOverlayLiveText({ committed: '', draft: '所以他实际上有一个网页应用程序', maxChars: 28 }),
    ).toBe('所以他实际上有一个网页应用程序')
  })

  it('Chinese draft grows naturally to the right (no left-shift while under budget)', () => {
    const sequence = [
      '所以他实际上',
      '所以他实际上有一个',
      '所以他实际上有一个网页',
      '所以他实际上有一个网页应用程序',
    ]
    let prevOut = ''
    for (const draft of sequence) {
      const out = getOverlayLiveText({ committed: '', draft, maxChars: 28 })
      if (prevOut) expect(out.startsWith(prevOut)).toBe(true)
      expect(out).toBe(draft)
      prevOut = out
    }
  })
})

describe('splitOverlayLiveSegments', () => {
  it('returns committed-tail + draft separately when within budget', () => {
    const out = splitOverlayLiveSegments({
      committed: 'Hello world. The second',
      draft: 'sentence',
      maxChars: 60,
    })
    expect(out.committed).toBe('The second')
    expect(out.draft).toBe('sentence')
  })

  it('returns last completed sentence in `committed` slot when nothing is in progress', () => {
    const out = splitOverlayLiveSegments({
      committed: 'A. B. C is done.',
      draft: '',
      maxChars: 60,
    })
    expect(out.committed).toBe('C is done.')
    expect(out.draft).toBe('')
  })

  it('drops committed entirely when draft alone exceeds budget', () => {
    const out = splitOverlayLiveSegments({
      committed: 'Earlier text fragments here',
      draft: 'one two three four five six seven eight nine ten eleven twelve',
      maxChars: 30,
    })
    expect(out.committed).toBe('')
    expect(out.draft.length).toBeLessThanOrEqual(30)
    expect(out.draft).not.toContain('…')
    expect(out.draft.endsWith('twelve')).toBe(true)
  })

  it('trims committed from the left to make room for draft', () => {
    const out = splitOverlayLiveSegments({
      committed: 'aaaaaaaaaaaaaaaaaa bbbbbbbbb cccccccccc',
      draft: 'newest',
      maxChars: 20,
    })
    // Total budget = 20; "newest" is 6 chars + 1 sep = 7 reserved for draft;
    // committed gets 13 chars max.
    expect(out.draft).toBe('newest')
    expect(out.committed.length).toBeLessThanOrEqual(13)
    expect(out.committed).not.toContain('…')
  })

  it('output never contains ellipsis', () => {
    const out = splitOverlayLiveSegments({
      committed: 'x'.repeat(500),
      draft: 'y'.repeat(50),
      maxChars: 30,
    })
    expect(out.committed).not.toContain('…')
    expect(out.draft).not.toContain('…')
    expect(out.committed).not.toContain('...')
    expect(out.draft).not.toContain('...')
  })

  // ── Stale-completed-sentence suppression ────────────────────────────────
  // When the speaker has finished a sentence and started a new draft,
  // the OLD completed sentence MUST disappear from the overlay — it
  // must not linger as `committed` while the new draft renders.

  it('drops the previous completed sentence from `committed` when draft starts a new sentence', () => {
    const out = splitOverlayLiveSegments({
      committed: 'Hello world.',
      draft: 'This is the next',
      maxChars: 80,
    })
    expect(out.committed).toBe('')
    expect(out.draft).toBe('This is the next')
    // The combined render must not contain the old sentence at all.
    const rendered = (out.committed + ' ' + out.draft).trim()
    expect(rendered).not.toContain('Hello world')
    expect(rendered).toBe('This is the next')
  })

  it('preserves only the *current* sentence fragment from committed when it belongs to the same sentence as draft', () => {
    const out = splitOverlayLiveSegments({
      committed: 'Hello world. This is',
      draft: 'the next',
      maxChars: 80,
    })
    // "This is" is the current sentence-in-progress in committed —
    // it belongs together with "the next" → keep both, drop "Hello world."
    expect(out.committed).toBe('This is')
    expect(out.draft).toBe('the next')
    const rendered = (out.committed + ' ' + out.draft).trim()
    expect(rendered).toBe('This is the next')
    expect(rendered).not.toContain('Hello world')
  })

  it('Chinese: drops the previous 。 sentence when draft starts a new phrase', () => {
    const out = splitOverlayLiveSegments({
      committed: '今天我们讨论数据库。',
      draft: 'B树是非常常见的索引结构',
      maxChars: 28,
    })
    expect(out.committed).toBe('')
    expect(out.draft).toBe('B树是非常常见的索引结构')
    expect((out.committed + out.draft)).not.toContain('数据库')
  })
})
