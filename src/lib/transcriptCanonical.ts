export {
  canonicalizeLectureTranscript,
  transcriptCanonicalQualityGate,
} from './transcriptCanonicalCore.js'

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
