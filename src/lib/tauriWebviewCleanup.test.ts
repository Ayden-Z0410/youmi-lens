import { describe, expect, it } from 'vitest'
import { shouldCloseAuthCleanupWebview } from './tauriWebviewCleanup'

describe('shouldCloseAuthCleanupWebview', () => {
  it('preserves product webviews during auth cleanup', () => {
    expect(shouldCloseAuthCleanupWebview('main')).toBe(false)
    expect(shouldCloseAuthCleanupWebview('overlay')).toBe(false)
  })

  it('closes disposable auxiliary webviews', () => {
    expect(shouldCloseAuthCleanupWebview('auth-callback')).toBe(true)
    expect(shouldCloseAuthCleanupWebview('oauth')).toBe(true)
  })
})
