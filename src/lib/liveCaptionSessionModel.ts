/**
 * Minimal live-caption display state machine (LiveEngine v2 UI path).
 * Two slots each language: committed (history) + current (single replaceable line).
 * Stale translation / ASR results are dropped by utterance id + monotonic rev, not string heuristics.
 */
import { normCaptionSpaces, sanitizeEnglishForZhTranslate } from './liveCaptionSanitize'
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
  const persistPrimaryFull = [committedEnJoin, s.currentEn?.text ?? ''].filter(Boolean).join(' ').trim()
  const persistSecondaryFull = [committedZhJoin, s.currentZh?.text ?? ''].filter(Boolean).join(' ').trim()
  return {
    primaryBlack: committedEnJoin ? windowCaptionWords(committedEnJoin) : '',
    primaryGray: s.currentEn?.text ?? '',
    secondaryBlack: committedZhJoin ? windowCaptionWords(committedZhJoin) : '',
    secondaryGray: s.currentZh?.text ?? '',
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
      if (open >= 0 && seq < open) {
        return projectView(this.s)
      }
      const prev = this.s.lastEnInterimRevById.get(ev.segmentId) ?? 0
      if (ev.rev <= prev) {
        return projectView(this.s)
      }
      if (open >= 0 && seq > open && this.s.currentZh && this.s.currentZh.id !== ev.segmentId) {
        this.s.currentZh = null
      }
      this.s.lastEnInterimRevById.set(ev.segmentId, ev.rev)
      trimRevMap(this.s.lastEnInterimRevById)
      this.s.currentEn = { id: ev.segmentId, rev: ev.rev, text: ev.text.trim() }
      if (this.s.currentZh && this.s.currentZh.id !== ev.segmentId) {
        this.s.currentZh = null
      }
      this.s.openUtteranceSeq = seq
      return projectView(this.s)
    }

    if (ev.type === 'en_final') {
      if (open >= 0 && seq < open) {
        return projectView(this.s)
      }
      const text = ev.text.trim()
      if (text) {
        this.s.lastEnFinalSanitizedById.set(ev.segmentId, sanitizeEnglishForZhTranslate(text))
        this.s.committedEn = [...this.s.committedEn, { id: ev.segmentId, text }]
      }
      if (this.s.currentEn?.id === ev.segmentId) {
        this.s.currentEn = null
      }
      this.s.openUtteranceSeq = seq
      return projectView(this.s)
    }

    if (ev.type === 'zh_interim') {
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
        this.s.committedZh = [...this.s.committedZh, { id: ev.segmentId, text }]
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
