/**
 * Overlay caption helpers — extract only the LATEST words the speaker is
 * saying right now. The Lecture Overlay is a live-reading HUD, not a
 * transcript viewer; the most recent words always win, and the caption
 * row is intentionally short so updates feel real-time.
 *
 * Sentence boundaries (per product spec):
 *   English: . ? ! ; :
 *   Chinese: 。？！；：
 *
 * Public API:
 *   - tailForOverlay(text, max)             trailing tail, no ellipsis
 *   - getLatestOverlaySentence(text, max)   last completed / in-progress
 *                                           sentence, no ellipsis
 *   - getOverlayLiveText({ committed, draft, max })
 *       Live HUD text: when the speaker is mid-sentence (draft non-empty
 *       OR committed has unterminated trailing fragment), show that
 *       in-progress phrase only. When the sentence has just ended (draft
 *       empty AND committed ends with sentence-boundary), fall back to
 *       the last completed sentence. Avoids the "stale completed
 *       sentence + new draft both visible" anti-pattern.
 *   - splitOverlayLiveSegments(...)
 *       Same logic but returns { committed, draft } separately so the
 *       OverlayWindow can render the committed prefix in white and the
 *       draft suffix in gray italic, while the COMBINED tail still
 *       respects the maxChars budget.
 *
 * No function in this module ever prepends "…" or "..." — students need
 * to read the newest words; ellipsis at the right edge would hide them.
 */

const SENTENCE_BOUNDARY = /[.?!。？！；;:：]+\s*/g

/**
 * Take the trailing tail of `text` capped at `maxChars`, preferring an
 * English word boundary when one is cheaply reachable. Never adds "…".
 */
export function tailForOverlay(text: string, maxChars: number): string {
  if (!text) return ''
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  if (cleaned.length <= maxChars) return cleaned

  const tail = cleaned.slice(-maxChars)
  // English-like text: if the very front of the tail starts mid-word,
  // skip past the first whitespace so we begin at a clean word — but
  // only when that boundary is close to the start (≤ 25% of the budget).
  // Otherwise we'd discard meaningful content. Chinese tails typically
  // have no internal whitespace, so this branch is a no-op.
  const firstSpace = tail.indexOf(' ')
  const wordBoundaryBudget = Math.floor(maxChars * 0.25)
  if (firstSpace > 0 && firstSpace <= wordBoundaryBudget) {
    return tail.slice(firstSpace + 1).trimStart()
  }
  return tail.trimStart()
}

/** Find the in-progress fragment of `committed` (text after the last
 *  sentence-terminator). Empty if `committed` is empty or ends ON a
 *  terminator. */
function inProgressTail(committed: string): string {
  if (!committed) return ''
  const cleaned = committed.replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  const re = new RegExp(SENTENCE_BOUNDARY)
  re.lastIndex = 0
  let lastEnd = -1
  let m: RegExpExecArray | null
  while ((m = re.exec(cleaned)) !== null) {
    lastEnd = m.index + m[0].length
    if (m[0].length === 0) re.lastIndex += 1
  }
  if (lastEnd < 0) return cleaned
  if (lastEnd >= cleaned.length) return '' // ends on boundary — no fragment
  return cleaned.slice(lastEnd).trim()
}

/** Last completed sentence in `committed`, or '' if there are none. */
function lastCompletedSentence(committed: string): string {
  if (!committed) return ''
  const cleaned = committed.replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  const re = new RegExp(SENTENCE_BOUNDARY)
  re.lastIndex = 0
  const ends: number[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(cleaned)) !== null) {
    ends.push(m.index + m[0].length)
    if (m[0].length === 0) re.lastIndex += 1
  }
  if (ends.length === 0) return cleaned
  const last = ends[ends.length - 1]
  if (last >= cleaned.length) {
    // ends on boundary → previous boundary is the start of the last sentence
    const start = ends.length >= 2 ? ends[ends.length - 2] : 0
    return cleaned.slice(start).trim()
  }
  // doesn't end on a boundary → unfinished fragment is the "current",
  // last completed is between previous-previous and last boundary
  const start = ends.length >= 2 ? ends[ends.length - 2] : 0
  return cleaned.slice(start, last).trim()
}

/**
 * Extract the latest sentence (or in-progress phrase) from accumulated
 * caption text, capped to `maxChars`. When over budget, the trailing
 * portion is returned verbatim — never with a leading "…".
 */
export function getLatestOverlaySentence(text: string, maxChars: number): string {
  if (!text) return ''
  const inProgress = inProgressTail(text)
  if (inProgress) return tailForOverlay(inProgress, maxChars)
  // Text ends on a boundary — return the last completed sentence
  return tailForOverlay(lastCompletedSentence(text), maxChars)
}

/**
 * Trim a draft / interim caption fragment to a max char budget, keeping
 * the trailing portion (latest words). No leading "…".
 */
export function trimOverlayDraft(text: string, maxChars: number): string {
  return tailForOverlay(text, maxChars)
}

/**
 * Live HUD text: prefer the in-progress phrase (committed-tail-since-
 * last-boundary + draft) over a stale just-completed sentence. Returns
 * one tail-trimmed string suitable for the overlay.
 */
export function getOverlayLiveText(args: {
  committed: string
  draft: string
  maxChars: number
}): string {
  const { committed, draft, maxChars } = args
  const draftClean = (draft || '').replace(/\s+/g, ' ').trim()
  const inProgress = inProgressTail(committed || '')
  const sep = inProgress && draftClean ? ' ' : ''
  const live = inProgress + sep + draftClean
  if (live) return tailForOverlay(live, maxChars)
  // No in-progress text at all — show the last completed sentence so
  // the row isn't blank during a brief between-sentences pause.
  return tailForOverlay(lastCompletedSentence(committed || ''), maxChars)
}

/**
 * Same as `getOverlayLiveText` but returns the committed-tail and
 * draft portions separately, after applying the combined char budget.
 * Useful when the renderer wants the committed portion in white and
 * the draft portion in gray italic. The combined visual width respects
 * `maxChars`.
 *
 * Returned `committed` is the "in-progress" tail of the source
 * `committed` (text after last sentence boundary), AFTER any leading
 * truncation needed to fit the budget. `draft` is the raw draft,
 * possibly truncated from the LEFT if the committed portion has been
 * dropped entirely.
 *
 * If both committed-in-progress and draft are empty, returns the last
 * completed sentence in the committed slot (white) and an empty draft.
 */
export function splitOverlayLiveSegments(args: {
  committed: string
  draft: string
  maxChars: number
}): { committed: string; draft: string } {
  const { committed, draft, maxChars } = args
  const draftClean = (draft || '').replace(/\s+/g, ' ').trim()
  const inProgressCommitted = inProgressTail(committed || '')

  if (!inProgressCommitted && !draftClean) {
    return { committed: tailForOverlay(lastCompletedSentence(committed || ''), maxChars), draft: '' }
  }

  const sep = inProgressCommitted && draftClean ? ' ' : ''
  const combined = inProgressCommitted + sep + draftClean
  if (combined.length <= maxChars) {
    return { committed: inProgressCommitted, draft: draftClean }
  }

  // Combined exceeds budget. Prefer to drop committed bytes from the
  // left first (older words); only trim into draft if necessary.
  if (draftClean.length >= maxChars) {
    // Draft alone exceeds budget — drop committed entirely, tail-trim draft.
    return { committed: '', draft: tailForOverlay(draftClean, maxChars) }
  }
  // Reserve space for draft + separator; spend the rest on committed tail.
  const reserve = draftClean.length + (sep ? 1 : 0)
  const committedBudget = Math.max(0, maxChars - reserve)
  const committedTail = tailForOverlay(inProgressCommitted, committedBudget)
  return { committed: committedTail, draft: draftClean }
}
