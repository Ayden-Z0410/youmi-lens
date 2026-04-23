/**
 * Same-utterance EN interim locked-prefix stabilization.
 *
 * ASR full-snapshot rewrites follow the pattern:
 *   raw1 = "A B C"
 *   raw2 = "A B C D E"
 *   raw3 = "A B C D E  A B C D E F"     (re-expanded from beginning)
 *   raw4 = "A B C D E F  A B C D E F G"  (again)
 *
 * We maintain a lockedText that only grows.  On each new snapshot we search
 * for the LAST occurrence of our "anchor" (trailing N words of lockedText)
 * inside the new snapshot; everything after that anchor is the net-new tail.
 * This strips away the re-expanded prefix wall deterministically.
 */
import { normCaptionSpaces } from './liveCaptionSanitize'

// --- State ---

export type EnInterimStabilizeState = {
  lockedText: string
  lockedWords: string[]
}

export function initialEnInterimStabilizeState(): EnInterimStabilizeState {
  return { lockedText: '', lockedWords: [] }
}

// --- Helpers ---

function toWords(s: string): string[] {
  return normCaptionSpaces(s).split(/\s+/).filter(Boolean)
}

/**
 * Find the LAST position where needle words appear within haystack words
 * (case-insensitive).  Returns the index in haystack right AFTER the match
 * end, or -1 if not found.
 */
function lastIndexAfterWordSequence(haystack: string[], needle: string[]): number {
  const nLen = needle.length
  if (nLen === 0 || nLen > haystack.length) return -1
  for (let start = haystack.length - nLen; start >= 0; start--) {
    let match = true
    for (let j = 0; j < nLen; j++) {
      if (haystack[start + j]!.toLowerCase() !== needle[j]!.toLowerCase()) {
        match = false
        break
      }
    }
    if (match) return start + nLen
  }
  return -1
}

/**
 * Given locked words and new raw words, find the genuinely new tail in raw
 * that extends beyond what is already in locked.
 *
 * Uses the last N words of locked as an "anchor" and searches for the LAST
 * occurrence of that anchor in raw; everything after that occurrence is new.
 * Tries progressively shorter anchors (down to 3 words) to handle minor ASR
 * rewrites at the boundary.
 */
function extractNetNewWords(lockedW: string[], rawW: string[]): string[] {
  const maxAnchor = Math.min(lockedW.length, 20)
  const minAnchor = 3
  for (let anchorLen = maxAnchor; anchorLen >= minAnchor; anchorLen--) {
    const anchor = lockedW.slice(-anchorLen)
    const afterIdx = lastIndexAfterWordSequence(rawW, anchor)
    if (afterIdx >= 0) {
      return rawW.slice(afterIdx)
    }
  }
  return []
}

// --- Public API ---

/**
 * Stabilize one EN interim snapshot for a given utterance.
 *
 * lockedText only grows; new ASR snapshots can only contribute words that
 * appear AFTER the last occurrence of our anchor within the snapshot.
 */
export function stabilizeEnInterimSnapshot(
  state: EnInterimStabilizeState,
  rawIn: string,
): { text: string; state: EnInterimStabilizeState } {
  const raw = normCaptionSpaces(rawIn)
  if (!raw) return { text: state.lockedText, state }

  if (!state.lockedText) {
    const w = toWords(raw)
    return { text: raw, state: { lockedText: raw, lockedWords: w } }
  }

  const rawW = toWords(raw)
  const netNew = extractNetNewWords(state.lockedWords, rawW)

  if (netNew.length > 0) {
    const result = normCaptionSpaces(state.lockedText + ' ' + netNew.join(' '))
    const rw = toWords(result)
    return { text: result, state: { lockedText: result, lockedWords: rw } }
  }

  // Fallback: anchor search failed but raw is a pure string extension of locked
  if (raw.startsWith(state.lockedText)) {
    return { text: raw, state: { lockedText: raw, lockedWords: rawW } }
  }

  // No genuinely new content found -- keep locked unchanged
  return { text: state.lockedText, state }
}
