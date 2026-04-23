/**
 * Same-utterance EN interim monotonic stabilization: tame ASR full-snapshot
 * rewrites (A -> A+B -> A'+B) without heavy NLP or whole-text dedup passes.
 */
import { normCaptionSpaces } from './liveCaptionSanitize'

const DEFAULT_MAX_HISTORY = 5

export type EnInterimStabilizeState = {
  history: string[]
  lastShown: string
}

export function initialEnInterimStabilizeState(): EnInterimStabilizeState {
  return { history: [], lastShown: '' }
}

export function longestCommonPrefix(a: string, b: string): string {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++
  return a.slice(0, i)
}

export function longestCommonPrefixMany(strings: readonly string[]): string {
  if (strings.length === 0) return ''
  let p = strings[0]!
  for (let k = 1; k < strings.length; k++) {
    p = longestCommonPrefix(p, strings[k]!)
    if (!p) break
  }
  return p
}

function tokenizeWords(s: string): string[] {
  return normCaptionSpaces(s)
    .split(/\s+/)
    .filter(Boolean)
}

/** True if new tail has a word (4+ chars) not appearing as substring in old tail. */
export function tailHasNetNewContent(oldTail: string, newTail: string): boolean {
  const o = oldTail.toLowerCase()
  const words = tokenizeWords(newTail)
  for (const w of words) {
    if (w.length < 4) continue
    if (!o.includes(w.toLowerCase())) return true
  }
  return newTail.trim().length > oldTail.trim().length + 12
}

/**
 * Merge two tails after a shared prefix: prefer extension, else word-overlap bridge,
 * else keep old unless new clearly adds content.
 */
export function mergeTailsByWordOverlap(tailOld: string, tailNew: string): string {
  const a = tailOld.trim()
  const b = tailNew.trim()
  if (!a) return b
  if (!b) return a
  if (b.startsWith(a)) return b
  if (a.startsWith(b)) return a
  const wa = tokenizeWords(a)
  const wb = tokenizeWords(b)
  const maxK = Math.min(wa.length, wb.length)
  for (let k = maxK; k >= 1; k--) {
    if (wa.slice(-k).join(' ') === wb.slice(0, k).join(' ')) {
      return normCaptionSpaces(a + ' ' + wb.slice(k).join(' '))
    }
  }
  if (tailHasNetNewContent(a, b)) return b
  return a.length >= b.length ? a : b
}

export type StabilizeEnOptions = { maxHistory?: number }

/**
 * Turn a raw ASR full snapshot into a monotonic line for one utterance (segmentId):
 * - Keeps a rolling agreement prefix across recent snapshots when it still prefixes `raw` and `lastShown`.
 * - Rejects no-op / shrink-only resends without net-new words.
 * - Builds tail via word-overlap glue so partial rewrites do not prepend a duplicate wall.
 */
export function stabilizeEnInterimSnapshot(
  state: EnInterimStabilizeState,
  rawIn: string,
  opts?: StabilizeEnOptions,
): { text: string; state: EnInterimStabilizeState } {
  const maxHistory = opts?.maxHistory ?? DEFAULT_MAX_HISTORY
  const raw = normCaptionSpaces(rawIn)
  if (!raw) {
    return { text: state.lastShown, state }
  }

  const lastShown = state.lastShown
  const history = [...state.history, raw].slice(-maxHistory)

  if (!lastShown) {
    return { text: raw, state: { history, lastShown: raw } }
  }

  if (raw.startsWith(lastShown)) {
    return { text: raw, state: { history, lastShown: raw } }
  }

  const multi =
    history.length >= 2 ? longestCommonPrefixMany(history) : ''
  const pair = longestCommonPrefix(lastShown, raw)

  let pref = pair
  if (
    multi.length > pair.length &&
    raw.startsWith(multi) &&
    lastShown.startsWith(multi)
  ) {
    pref = multi
  }

  const tailNew = raw.slice(pref.length)
  const tailOld = lastShown.slice(pref.length)

  if (!tailNew.trim()) {
    return { text: lastShown, state: { history, lastShown } }
  }

  if (
    raw.length + 8 < lastShown.length &&
    !tailHasNetNewContent(tailOld, tailNew)
  ) {
    return { text: lastShown, state: { history, lastShown } }
  }

  const mergedTail = mergeTailsByWordOverlap(tailOld, tailNew)
  let out = normCaptionSpaces(pref + mergedTail)

  if (
    out.length < lastShown.length &&
    !lastShown.startsWith(out) &&
    !tailHasNetNewContent(lastShown, raw)
  ) {
    out = lastShown
  }

  return { text: out, state: { history, lastShown: out } }
}
