import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveEngine } from './engine'
import type { LiveEngineEvent } from './types'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

const adapterMock = vi.hoisted(() => {
  const instances: Array<{
    listener: ((event: unknown) => void) | null
    emit: (event: unknown) => void
  }> = []

  class MockYoumiLiveAdapter {
    listener: ((event: unknown) => void) | null = null

    constructor() {
      instances.push(this)
    }

    onEvent(listener: (event: unknown) => void) {
      this.listener = listener
    }

    start() {}

    stop() {}

    warmSession() {
      return Promise.resolve()
    }

    notifyAudioEnd() {}

    markRecordingPcmActivity() {}

    pushPcm() {}

    pushChunk() {
      return Promise.resolve()
    }

    emit(event: unknown) {
      this.listener?.(event)
    }
  }

  return { instances, MockYoumiLiveAdapter }
})

const aiMock = vi.hoisted(() => ({
  translateLiveCaption: vi.fn(),
  TranslateCaptionAuthError: class TranslateCaptionAuthError extends Error {},
  TranslateCaptionTransientError: class TranslateCaptionTransientError extends Error {},
}))

vi.mock('./adapters/youmiAdapter', () => ({
  YoumiLiveAdapter: adapterMock.MockYoumiLiveAdapter,
}))

vi.mock('../aiClient', () => aiMock)

function zhFinalEvents(events: LiveEngineEvent[]) {
  return events.filter((ev): ev is Extract<LiveEngineEvent, { type: 'zh_final' }> => ev.type === 'zh_final')
}

describe('LiveEngine translation durability', () => {
  beforeEach(() => {
    adapterMock.instances.length = 0
    aiMock.translateLiveCaption.mockReset()
  })

  it('does not emit stale translation completions into a restarted recording', async () => {
    const oldTranslation = deferred<string>()
    aiMock.translateLiveCaption
      .mockReturnValueOnce(oldTranslation.promise)
      .mockResolvedValueOnce('new translation')

    const engine = new LiveEngine()
    const events: LiveEngineEvent[] = []
    engine.onEvent((ev) => events.push(ev))

    engine.start({ translateTarget: 'en' })
    adapterMock.instances[0].emit({
      type: 'en_final',
      segmentId: 'stream-1',
      text: 'alpha bravo charlie.',
    })

    expect(aiMock.translateLiveCaption).toHaveBeenCalledTimes(1)

    engine.stop()
    engine.start({ translateTarget: 'en' })

    oldTranslation.resolve('old translation')
    await flushAsync()

    adapterMock.instances[1].emit({
      type: 'en_final',
      segmentId: 'stream-1',
      text: 'delta echo foxtrot.',
    })
    await flushAsync()

    expect(zhFinalEvents(events).map((ev) => ({
      text: ev.text,
      sourceEn: ev.sourceEn,
    }))).toEqual([
      {
        text: 'new translation',
        sourceEn: 'delta echo foxtrot.',
      },
    ])
  })

  it('preserves every queued final translation under backlog', async () => {
    const calls: Array<Deferred<string> & { text: string; resolved: boolean }> = []
    aiMock.translateLiveCaption.mockImplementation((text: string) => {
      const d = deferred<string>()
      calls.push({ ...d, text, resolved: false })
      return d.promise
    })

    const engine = new LiveEngine()
    const events: LiveEngineEvent[] = []
    engine.onEvent((ev) => events.push(ev))
    engine.start({ translateTarget: 'en' })

    const finalTexts = [
      'alpha bravo charlie.',
      'delta echo foxtrot.',
      'golf hotel india.',
      'juliet kilo lima.',
      'mike november oscar.',
      'papa quebec romeo.',
      'sierra tango uniform.',
      'victor whiskey xray.',
    ]

    finalTexts.forEach((text, index) => {
      adapterMock.instances[0].emit({
        type: 'en_final',
        segmentId: `stream-${index + 1}`,
        text,
      })
    })

    for (let step = 0; step < 20 && calls.length < finalTexts.length; step++) {
      calls.forEach((call, index) => {
        if (call.resolved) return
        call.resolved = true
        call.resolve(`translation ${index + 1}`)
      })
      await flushAsync()
    }

    calls.forEach((call, index) => {
      if (call.resolved) return
      call.resolved = true
      call.resolve(`translation ${index + 1}`)
    })
    await flushAsync()

    expect(calls.map((call) => call.text)).toEqual(finalTexts)
    expect(zhFinalEvents(events).map((ev) => ev.text)).toEqual(
      finalTexts.map((_, index) => `translation ${index + 1}`),
    )
  })
})
