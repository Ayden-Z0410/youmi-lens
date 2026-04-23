/**
 * Live caption event-stream audit trace.
 *
 * Attach to a LiveEngine session via traceLiveCaptionSession().
 * Logs every en/zh event with change classification so we can diagnose
 * whether the problem is upstream ASR, translation, or display logic.
 *
 * Output: console.info('[CaptionTrace] ...') -- open DevTools Console,
 * filter by "CaptionTrace" to see the full audit.
 */

type ChangeKind =
  | 'new_segment'
  | 'exact_same'
  | 'prefix_growth'
  | 'suffix_rewrite'
  | 'full_rewrite'
  | 'shorter_regression'

function classifyChange(prev: string, next: string): ChangeKind {
  if (!prev) return 'new_segment'
  if (prev === next) return 'exact_same'
  if (next.startsWith(prev)) return 'prefix_growth'
  if (next.length < prev.length) return 'shorter_regression'
  const lcp = longestCommonPrefixLen(prev, next)
  if (lcp > prev.length * 0.6) return 'suffix_rewrite'
  return 'full_rewrite'
}

function longestCommonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++
  return i
}

function head(s: string, n = 120): string {
  return s.length <= n ? s : s.slice(0, n) + '...'
}

function tail(s: string, n = 120): string {
  return s.length <= n ? s : '...' + s.slice(-n)
}

type SegHistory = {
  prevText: string
  interimCount: number
  firstInterimMs: number
  lastInterimMs: number
  finalMs: number
}

const segHistoryEn = new Map<string, SegHistory>()
const segHistoryZh = new Map<string, SegHistory>()
let sessionStartMs = 0

function elapsed(): number {
  return sessionStartMs ? Date.now() - sessionStartMs : 0
}

function getOrCreateHist(map: Map<string, SegHistory>, segId: string): SegHistory {
  let h = map.get(segId)
  if (!h) {
    h = { prevText: '', interimCount: 0, firstInterimMs: 0, lastInterimMs: 0, finalMs: 0 }
    map.set(segId, h)
  }
  return h
}

function out(tag: string, fields: Record<string, unknown>) {
  console.info(`[CaptionTrace] ${tag}`, JSON.stringify(fields, null, 0))
}

export function traceReset() {
  segHistoryEn.clear()
  segHistoryZh.clear()
  sessionStartMs = Date.now()
  out('RESET', { sessionStartMs })
}

export function traceEnInterim(segmentId: string, rev: number, text: string) {
  const h = getOrCreateHist(segHistoryEn, segmentId)
  const kind = classifyChange(h.prevText, text)
  const now = elapsed()
  if (h.interimCount === 0) h.firstInterimMs = now
  h.interimCount++
  const sinceLast = h.lastInterimMs ? now - h.lastInterimMs : 0
  h.lastInterimMs = now

  out('en_interim', {
    ms: now,
    segmentId,
    rev,
    kind,
    len: text.length,
    prevLen: h.prevText.length,
    sinceLast,
    interimN: h.interimCount,
    head: head(text),
    tail: tail(text),
  })

  h.prevText = text
}

export function traceEnFinal(segmentId: string, text: string) {
  const h = getOrCreateHist(segHistoryEn, segmentId)
  const kind = classifyChange(h.prevText, text)
  const now = elapsed()
  const sinceFirstInterim = h.firstInterimMs ? now - h.firstInterimMs : 0
  h.finalMs = now

  out('en_final', {
    ms: now,
    segmentId,
    kind,
    len: text.length,
    prevLen: h.prevText.length,
    interimCount: h.interimCount,
    sinceFirstInterim,
    head: head(text),
    tail: tail(text),
  })

  h.prevText = text
}

export function traceZhInterim(
  segmentId: string,
  rev: number,
  text: string,
  sourceEn: string,
  dropped: string | null,
) {
  const h = getOrCreateHist(segHistoryZh, segmentId)
  const now = elapsed()
  h.interimCount++

  out('zh_interim', {
    ms: now,
    segmentId,
    rev,
    len: text.length,
    sourceEnLen: sourceEn.length,
    interimN: h.interimCount,
    dropped,
    head: head(text),
    tail: tail(text),
  })

  if (!dropped) h.prevText = text
}

export function traceZhFinal(
  segmentId: string,
  text: string,
  sourceEn: string,
  dropped: string | null,
) {
  const h = getOrCreateHist(segHistoryZh, segmentId)
  const now = elapsed()

  out('zh_final', {
    ms: now,
    segmentId,
    len: text.length,
    sourceEnLen: sourceEn.length,
    dropped,
    head: head(text),
    tail: tail(text),
  })

  if (!dropped) h.prevText = text
}

export function traceView(view: {
  primaryBlack: string
  primaryGray: string
  secondaryBlack: string
  secondaryGray: string
}) {
  out('VIEW', {
    ms: elapsed(),
    blackEnLen: view.primaryBlack.length,
    grayEnLen: view.primaryGray.length,
    blackZhLen: view.secondaryBlack.length,
    grayZhLen: view.secondaryGray.length,
    grayEnHead: head(view.primaryGray, 80),
    grayZhHead: head(view.secondaryGray, 80),
  })
}
