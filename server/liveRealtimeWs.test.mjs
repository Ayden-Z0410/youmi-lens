import { describe, expect, it, vi } from 'vitest'
import { finalizeLiveSegmentForRestart } from './liveRealtimeWs.mjs'

describe('finalizeLiveSegmentForRestart', () => {
  it('clears the previous session cleanup before finalizing restart cost', () => {
    const onSessionEnd = vi.fn()
    const finalizeCost = vi.fn()
    const ws = {
      _youmiLiveSessionEnd: onSessionEnd,
      _youmiDeepgramCostFinalize: finalizeCost,
    }

    finalizeLiveSegmentForRestart(ws)

    expect(onSessionEnd).toHaveBeenCalledTimes(1)
    expect(finalizeCost).toHaveBeenCalledWith('restart')
    expect(onSessionEnd.mock.invocationCallOrder[0]).toBeLessThan(
      finalizeCost.mock.invocationCallOrder[0],
    )
    expect(ws._youmiLiveSessionEnd).toBeNull()
    expect(ws._youmiDeepgramCostFinalize).toBeNull()
  })
})
