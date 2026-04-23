/**
 * Token-based English de-overlap layer.
 *
 * ASR providers send cumulative full-utterance snapshots: every en_interim and
 * en_final starts from the beginning of the utterance. This module compares
 * incoming text against the already-committed transcript and extracts only the
 * genuinely new (novel) portion.
 *
 * Two strategies:
 *   1. Anchor search -- find committed's last N tokens in incoming, everything
 *      after the anchor is novel.
 *   2. Containment check -- bag-of-words fallback for re-segmented / duplicate
 *      finals whose text is already fully covered by committed.
 */

// ?? Tokenizer + normalizer ??????????????????????????????????????????????????

function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

/** Lowercase, strip leading/trailing punctuation so "class," matches "class". */
function norm(token: string): string {
  return token.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
}

// ?? Public result type ??????????????????????????????????????????????????????

export type DeOverlapVerdict = 'anchor_cut' | 'containment_drop' | 'no_overlap_keep' | 'empty_committed'

export interface DeOverlapResult {
  novelText: string
  verdict: DeOverlapVerdict
  overlapTokenCount: number
  incomingTokenCount: number
  novelTokenCount: number
  overlapPreview: string
  novelPreview: string
  matchedAnchorLen: number
  matchedAnchorText: string
  suspiciousShortAnchor: boolean
  containmentRatio: number
}

// ?? Main entry point ????????????????????????????????????????????????????????

export function deOverlapEnglish(
  committedEnFull: string,
  incoming: string,
): DeOverlapResult {
  const inTokens = tokenize(incoming)

  if (!committedEnFull.trim() || inTokens.length === 0) {
    const text = incoming.trim()
    return buildResult(inTokens, 0, {
      verdict: 'empty_committed',
      novelOverride: text,
    })
  }

  const cTokens = tokenize(committedEnFull)
  const normC = cTokens.map(norm)
  const normIn = inTokens.map(norm)

  // Strategy 1: Anchor search
  const maxAnchor = Math.min(10, normC.length)
  for (let anchorLen = maxAnchor; anchorLen >= 3; anchorLen--) {
    const anchor = normC.slice(-anchorLen)
    const pos = findSubseq(normIn, anchor)
    if (pos >= 0) {
      const overlapEnd = pos + anchorLen
      const anchorOrigTokens = cTokens.slice(-anchorLen)
      return buildResult(inTokens, overlapEnd, {
        verdict: 'anchor_cut',
        matchedAnchorLen: anchorLen,
        matchedAnchorText: anchorOrigTokens.join(' '),
        suspiciousShortAnchor: anchorLen <= 4,
      })
    }
  }

  // Strategy 2: Containment (bag-of-words)
  const windowSize = Math.min(normC.length, 250)
  const bag = new Map<string, number>()
  for (let i = normC.length - windowSize; i < normC.length; i++) {
    const t = normC[i]
    bag.set(t, (bag.get(t) ?? 0) + 1)
  }

  const bagCopy = new Map(bag)
  let covered = 0
  for (const t of normIn) {
    const c = bagCopy.get(t) ?? 0
    if (c > 0) {
      covered++
      bagCopy.set(t, c - 1)
    }
  }

  const containmentRatio = normIn.length > 0 ? covered / normIn.length : 0

  if (normIn.length >= 5 && covered >= normIn.length * 0.85) {
    return buildResult(inTokens, inTokens.length, {
      verdict: 'containment_drop',
      novelOverride: '',
      containmentRatio,
    })
  }

  return buildResult(inTokens, 0, {
    verdict: 'no_overlap_keep',
    containmentRatio,
  })
}

// ?? Helpers ?????????????????????????????????????????????????????????????????

/** Find first occurrence of `needle` as contiguous subsequence in `haystack`. */
function findSubseq(haystack: string[], needle: string[]): number {
  const limit = haystack.length - needle.length
  outer: for (let i = 0; i <= limit; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}

type BuildOpts = {
  verdict: DeOverlapVerdict
  novelOverride?: string
  matchedAnchorLen?: number
  matchedAnchorText?: string
  suspiciousShortAnchor?: boolean
  containmentRatio?: number
}

function buildResult(
  inTokens: string[],
  overlapEnd: number,
  opts: BuildOpts,
): DeOverlapResult {
  const novelTokens = inTokens.slice(overlapEnd)
  const novelText = opts.novelOverride !== undefined ? opts.novelOverride : novelTokens.join(' ')
  const overlapTokens = inTokens.slice(0, overlapEnd)
  const overlapPreview = preview(overlapTokens.join(' '))
  const novelPreview = novelText.slice(0, 120)
  return {
    novelText,
    verdict: opts.verdict,
    overlapTokenCount: overlapEnd,
    incomingTokenCount: inTokens.length,
    novelTokenCount: novelTokens.length,
    overlapPreview,
    novelPreview,
    matchedAnchorLen: opts.matchedAnchorLen ?? 0,
    matchedAnchorText: opts.matchedAnchorText ?? '',
    suspiciousShortAnchor: opts.suspiciousShortAnchor ?? false,
    containmentRatio: opts.containmentRatio ?? 0,
  }
}

function preview(s: string): string {
  if (s.length <= 120) return s
  return s.slice(0, 55) + ' ... ' + s.slice(-55)
}
