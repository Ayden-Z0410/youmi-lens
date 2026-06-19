import { describe, expect, it } from 'vitest'
import { settlePriorLiveSessionForRestart } from './liveRealtimeWs.mjs'

describe('settlePriorLiveSessionForRestart', () => {
  it('clears the previous live-session cleanup before finalizing restart cost', () => {
    const calls = []
    const ws = {
      _youmiLiveSessionEnd: () => calls.push('live-end'),
      _youmiDeepgramCostFinalize: (reason) => calls.push(`cost:${reason}`),
    }

    settlePriorLiveSessionForRestart(ws)

    expect(calls).toEqual(['live-end', 'cost:restart'])
    expect(ws._youmiLiveSessionEnd).toBeNull()
    expect(ws._youmiDeepgramCostFinalize).toBeNull()
  })

  it('still finalizes cost if the prior session was already logged', () => {
    const calls = []
    const ws = {
      _youmiLiveSessionEnd: null,
      _youmiDeepgramCostFinalize: (reason) => calls.push(reason),
    }

    settlePriorLiveSessionForRestart(ws)

    expect(calls).toEqual(['restart'])
    expect(ws._youmiDeepgramCostFinalize).toBeNull()
  })
})
