export type LiveEngineStatus =
  | 'idle'
  | 'starting'
  | 'connected'
  | 'streaming'
  | 'reconnecting'
  | 'closed'
  | 'error'

export type LiveEngineEvent =
  | { type: 'status'; status: LiveEngineStatus; detail?: string }
  | { type: 'en_interim'; segmentId: string; rev: number; text: string }
  | { type: 'en_final'; segmentId: string; text: string }
  | { type: 'zh_interim'; segmentId: string; rev: number; text: string }
  | { type: 'zh_final'; segmentId: string; text: string }
  | { type: 'error'; code: string; message: string; recoverable: boolean }

export type LiveEngineListener = (event: LiveEngineEvent) => void

