import { describe, expect, it } from 'vitest'
import {
  initialRecordingFlow,
  recordingFlowReducer,
} from './recordingFlow'

describe('recordingFlowReducer', () => {
  it('LIVE_START arms recording and clears recordingId', () => {
    const s = recordingFlowReducer(
      { phase: 'idle', recordingId: 'x' },
      { type: 'LIVE_START' },
    )
    expect(s).toEqual({ phase: 'recording', recordingId: null })
  })

  it('CAPTURE_BEGIN moves to stopping with id', () => {
    const s = recordingFlowReducer(initialRecordingFlow, {
      type: 'CAPTURE_BEGIN',
      recordingId: 'rid-1',
    })
    expect(s).toEqual({ phase: 'stopping', recordingId: 'rid-1' })
  })

  it('CAPTURE_FINISHED returns to idle', () => {
    const s = recordingFlowReducer(
      { phase: 'verifying', recordingId: 'rid-1' },
      { type: 'CAPTURE_FINISHED' },
    )
    expect(s).toEqual({ phase: 'idle', recordingId: null })
  })

  it('AI_START then AI_DONE clears busy AI phases', () => {
    let s = recordingFlowReducer(initialRecordingFlow, {
      type: 'AI_START',
      recordingId: 'r',
    })
    expect(s.phase).toBe('transcribing')
    s = recordingFlowReducer(s, { type: 'AI_SUMMARIZE' })
    expect(s.phase).toBe('summarizing')
    s = recordingFlowReducer(s, { type: 'AI_DONE' })
    expect(s).toEqual({ phase: 'idle', recordingId: null })
  })
})
