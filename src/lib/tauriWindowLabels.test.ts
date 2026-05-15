import { describe, expect, it } from 'vitest'
import { shouldCloseAuxiliaryWebviewWindow } from './tauriWindowLabels'

describe('shouldCloseAuxiliaryWebviewWindow', () => {
  it('preserves first-class app windows', () => {
    expect(shouldCloseAuxiliaryWebviewWindow('main')).toBe(false)
    expect(shouldCloseAuxiliaryWebviewWindow('overlay')).toBe(false)
  })

  it('allows cleanup of auxiliary auth windows', () => {
    expect(shouldCloseAuxiliaryWebviewWindow('auth-popup')).toBe(true)
  })
})
