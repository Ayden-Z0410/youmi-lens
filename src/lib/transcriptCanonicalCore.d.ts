export type TranscriptCanonicalDiagnostics = {
  sentenceCountIn: number
  sentenceCountOut: number
  droppedNearDupPairs: number
  droppedRepeatedRuns: number
  termClustersMerged: number
}

export type CanonicalizeLectureTranscriptResult = {
  raw: string
  canonical: string
  diagnostics: TranscriptCanonicalDiagnostics
}

export function canonicalizeLectureTranscript(raw: string): CanonicalizeLectureTranscriptResult

export function transcriptCanonicalQualityGate(
  raw: string,
  opts?: { minCanonicalRatio?: number },
): { ok: boolean; reason?: string }
