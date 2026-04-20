/**
 * Minimal live-caption display state machine (LiveEngine v2 UI path).
 * Two slots each language: committed (history) + current (single replaceable line).
 * Stale translation / ASR results are dropped by utterance id + monotonic rev, not string heuristics.
 */
import {
  isGarbledMixedScriptLine,
  normCaptionSpaces,
  normalizeEnglishPrimaryPayloadOrReject,
  sanitizeEnglishForZhTranslate,
} from './liveCaptionSanitize'
import type { LiveEngineEvent } from './liveEngine/types'

export type UtteranceId = string

export type LiveCaptionCommittedLine = { id: UtteranceId; text: string }

export type LiveCaptionCurrentEn = { id: UtteranceId; rev: number; text: string } | null
export type LiveCaptionCurrentZh = { id: UtteranceId; rev: number; text: string } | null

export type LiveCaptionSessionState = {
  committedEn: LiveCaptionCommittedLine[]
  currentEn: LiveCaptionCurrentEn
  committedZh: LiveCaptionCommittedLine[]
  currentZh: LiveCaptionCurrentZh
  lastEnInterimRevById: Map<string, number>
  lastZhInterimRevById: Map<string, number>
  finalizedZhIds: Set<string>
  lastEnFinalSanitizedById: Map<string, string>
  /** segmentSeq of the utterance slot used to bind zh_* to the same English segment */
  openUtteranceSeq: number
}

export type LiveCaptionView = {
  primaryBlack: string
  primaryGray: string
  secondaryBlack: string
  secondaryGray: string
  persistPrimaryFull: string
  persistSecondaryFull: string
  committedEnJoin: string
}

export function liveCaptionSegmentSeq(segmentId: string): number {
  const m = /^(?:seg|stream)-(\d+)$/.exec(segmentId)
  if (!m) return Number.MAX_SAFE_INTEGER
  return Number(m[1])
}

function windowCaptionWords(full: string, maxWords = 150): string {
  const t = full.trim()
  if (!t) return ''
  const words = t.split(/\s+/)
  return words.length > maxWords ? words.slice(-maxWords).join(' ') : t
}

function joinLines(lines: readonly LiveCaptionCommittedLine[]): string {
  return lines.map((x) => x.text).join(' ').trim()
}

function trimRevMap(m: Map<string, number>, max = 48) {
  while (m.size > max) {
    const k = m.keys().next().value
    if (k === undefined) break
    m.delete(k)
  }
}

function initialState(): LiveCaptionSessionState {
  return {
    committedEn: [],
    currentEn: null,
    committedZh: [],
    currentZh: null,
    lastEnInterimRevById: new Map(),
    lastZhInterimRevById: new Map(),
    finalizedZhIds: new Set(),
    lastEnFinalSanitizedById: new Map(),
    openUtteranceSeq: -1,
  }
}

function projectView(s: LiveCaptionSessionState): LiveCaptionView {
  const committedEnJoin = joinLines(s.committedEn)
  const committedZhJoin = joinLines(s.committedZh)
  const rawGrayEn = s.currentEn?.text ?? ''
  const rawGrayZh = s.currentZh?.text ?? ''
  const primaryGray = grayIfNotDuplicateOfCommitted(committedEnJoin, rawGrayEn)
  const secondaryGray = grayIfNotDuplicateOfCommitted(committedZhJoin, rawGrayZh)
  const persistPrimaryFull = [committedEnJoin, rawGrayEn].filter(Boolean).join(' ').trim()
  const persistSecondaryFull = [committedZhJoin, rawGrayZh].filter(Boolean).join(' ').trim()
  return {
    primaryBlack: committedEnJoin ? windowCaptionWords(committedEnJoin) : '',
    primaryGray,
    secondaryBlack: committedZhJoin ? windowCaptionWords(committedZhJoin) : '',
    secondaryGray,
    persistPrimaryFull,
    persistSecondaryFull,
    committedEnJoin,
  }
}

function zhSourceMatchesCurrentEn(currentEn: NonNullable<LiveCaptionCurrentEn>, sourceEn: string): boolean {
  const cur = normCaptionSpaces(sanitizeEnglishForZhTranslate(currentEn.text)).toLowerCase()
  const src = normCaptionSpaces(sanitizeEnglishForZhTranslate(sourceEn)).toLowerCase()
  if (!src) return false
  if (src.length > cur.length) return false
  return cur === src || cur.startsWith(src)
}

/** Gray line must not repeat text already shown in committed (black) history. */
function grayIfNotDuplicateOfCommitted(committedJoin: string, gray: string): string {
  const g = gray.trim()
  if (!g) return ''
  const c = committedJoin.trim()
  if (!c) return gray
  if (c === g || c.endsWith(g)) return ''
  return gray
}

/**
 * Same-segment EN interim: allow strict extension (`next` starts with `prev`) or same/longer rewrites;
 * reject shorter non-extensions (ASR jitter / rollback).
 */
function enInterimIsNonRegressive(prevText: string, nextText: string): boolean {
  const a = prevText.trim()
  const b = nextText.trim()
  if (!a) return true
  if (!b) return false
  if (b.startsWith(a)) return true
  if (b.length >= a.length) return true
  return false
}

export type LiveCaptionEngineApplyEvent =
  | { type: 'en_interim'; segmentId: string; rev: number; text: string }
  | { type: 'en_final'; segmentId: string; text: string }
  | { type: 'zh_interim'; segmentId: string; rev: number; text: string; sourceEn: string }
  | { type: 'zh_final'; segmentId: string; text: string; sourceEn: string }

export function liveCaptionEventFromEngine(ev: LiveEngineEvent): LiveCaptionEngineApplyEvent | null {
  if (ev.type === 'en_interim' || ev.type === 'en_final' || ev.type === 'zh_interim' || ev.type === 'zh_final') {
    return ev
  }
  return null
}

export class LiveCaptionSessionModel {
  private s: LiveCaptionSessionState = initialState()

  reset() {
    this.s = initialState()
  }

  getView(): LiveCaptionView {
    return projectView(this.s)
  }

  /** Apply one caption event; returns updated view. */
  apply(ev: LiveCaptionEngineApplyEvent): LiveCaptionView {
    const seq = liveCaptionSegmentSeq(ev.segmentId)
    const open = this.s.openUtteranceSeq

    if (ev.type === 'en_interim') {
      const normalizedEn = normalizeEnglishPrimaryPayloadOrReject(ev.text)
      if (!normalizedEn) {
        return projectView(this.s)
      }
      if (open >= 0 && seq < open) {
        return projectView(this.s)
      }
      const prev = this.s.lastEnInterimRevById.get(ev.segmentId) ?? 0
      if (ev.rev <= prev) {
        return projectView(this.s)
      }
      const nextText = normalizedEn
      const sameSeg = this.s.currentEn?.id === ev.segmentId
      if (sameSeg && this.s.currentEn && !enInterimIsNonRegressive(this.s.currentEn.text, nextText)) {
        return projectView(this.s)
      }
      if (open >= 0 && seq > open && this.s.currentZh && this.s.currentZh.id !== ev.segmentId) {
        this.s.currentZh = null
      }
      this.s.lastEnInterimRevById.set(ev.segmentId, ev.rev)
      trimRevMap(this.s.lastEnInterimRevById)
      this.s.currentEn = { id: ev.segmentId, rev: ev.rev, text: nextText }
      if (this.s.currentZh && this.s.currentZh.id !== ev.segmentId) {
        this.s.currentZh = null
      }
      // EN current changed: drop ZH current for this segment so translator must re-bind to fresh sourceEn.
      if (this.s.currentZh?.id === ev.segmentId) {
        this.s.currentZh = null
      }
      this.s.openUtteranceSeq = seq
      return projectView(this.s)
    }

    if (ev.type === 'en_final') {
      const normalizedFinal = normalizeEnglishPrimaryPayloadOrReject(ev.text)
      if (!normalizedFinal) {
        return projectView(this.s)
      }
      if (open >= 0 && seq < open) {
        return projectView(this.s)
      }
      const text = normalizedFinal
      if (text) {
        this.s.lastEnFinalSanitizedById.set(ev.segmentId, sanitizeEnglishForZhTranslate(text))
        const idx = this.s.committedEn.findIndex((x) => x.id === ev.segmentId)
        if (idx >= 0) {
          /** Idempotent finalize: engine/ASR may emit duplicate stream_final for one utterance — replace, never append. */
          this.s.committedEn = this.s.committedEn.map((x, i) => (i === idx ? { id: ev.segmentId, text } : x))
        } else {
          this.s.committedEn = [...this.s.committedEn, { id: ev.segmentId, text }]
        }
      }
      if (this.s.currentEn?.id === ev.segmentId) {
        this.s.currentEn = null
      }
      this.s.openUtteranceSeq = seq
      return projectView(this.s)
    }

    if (ev.type === 'zh_interim') {
      if (isGarbledMixedScriptLine(ev.text)) {
        return projectView(this.s)
      }
      if (this.s.finalizedZhIds.has(ev.segmentId)) {
        return projectView(this.s)
      }
      if (open === -1 || seq !== open) {
        return projectView(this.s)
      }
      const prevZh = this.s.lastZhInterimRevById.get(ev.segmentId) ?? 0
      if (ev.rev <= prevZh) {
        return projectView(this.s)
      }
      const ce = this.s.currentEn
      if (!ce || ce.id !== ev.segmentId) {
        return projectView(this.s)
      }
      if (!zhSourceMatchesCurrentEn(ce, ev.sourceEn)) {
        return projectView(this.s)
      }
      this.s.lastZhInterimRevById.set(ev.segmentId, ev.rev)
      trimRevMap(this.s.lastZhInterimRevById)
      this.s.currentZh = { id: ev.segmentId, rev: ev.rev, text: ev.text.trim() }
      return projectView(this.s)
    }

    if (ev.type === 'zh_final') {
      if (isGarbledMixedScriptLine(ev.text)) {
        return projectView(this.s)
      }
      if (this.s.finalizedZhIds.has(ev.segmentId)) {
        return projectView(this.s)
      }
      const expectedSan = normCaptionSpaces(this.s.lastEnFinalSanitizedById.get(ev.segmentId) ?? '').toLowerCase()
      const srcSan = normCaptionSpaces(ev.sourceEn).toLowerCase()
      if (expectedSan && srcSan && expectedSan !== srcSan) {
        this.s.lastEnFinalSanitizedById.delete(ev.segmentId)
        return projectView(this.s)
      }
      this.s.lastEnFinalSanitizedById.delete(ev.segmentId)
      this.s.finalizedZhIds.add(ev.segmentId)
      const text = ev.text.trim()
      if (text) {
        const zidx = this.s.committedZh.findIndex((x) => x.id === ev.segmentId)
        if (zidx >= 0) {
          this.s.committedZh = this.s.committedZh.map((x, i) => (i === zidx ? { id: ev.segmentId, text } : x))
        } else {
          this.s.committedZh = [...this.s.committedZh, { id: ev.segmentId, text }]
        }
      }
      if (this.s.currentZh?.id === ev.segmentId) {
        this.s.currentZh = null
      }
      if (!this.s.currentEn && !this.s.currentZh) {
        this.s.openUtteranceSeq = -1
      }
      if (this.s.finalizedZhIds.size > 80) {
        const arr = [...this.s.finalizedZhIds]
        this.s.finalizedZhIds = new Set(arr.slice(-40))
      }
      return projectView(this.s)
    }

    return projectView(this.s)
  }
}
