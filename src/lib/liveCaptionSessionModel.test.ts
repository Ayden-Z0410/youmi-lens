import { describe, expect, it } from 'vitest'
import { LiveCaptionSessionModel } from './liveCaptionSessionModel'

describe('LiveCaptionSessionModel', () => {
  it('replaces repeated English finals for the same segment', () => {
    const model = new LiveCaptionSessionModel()

    model.apply({ type: 'en_final', segmentId: 'stream-0', text: 'Hello' })
    const view = model.apply({ type: 'en_final', segmentId: 'stream-0', text: 'Hello world' })

    expect(view.persistPrimaryFull).toBe('Hello world')
  })

  it('allows a revised segment to replace its finalized translation', () => {
    const model = new LiveCaptionSessionModel()

    model.apply({ type: 'en_final', segmentId: 'stream-0', text: 'Hello' })
    model.apply({ type: 'zh_final', segmentId: 'stream-0', text: 'old zh', sourceEn: 'Hello' })

    const revisedView = model.apply({
      type: 'en_final',
      segmentId: 'stream-0',
      text: 'Hello world',
    })
    expect(revisedView.persistPrimaryFull).toBe('Hello world')
    expect(revisedView.persistSecondaryFull).toBe('')

    const translatedView = model.apply({
      type: 'zh_final',
      segmentId: 'stream-0',
      text: 'new zh',
      sourceEn: 'Hello world',
    })
    expect(translatedView.persistSecondaryFull).toBe('new zh')
  })
})
