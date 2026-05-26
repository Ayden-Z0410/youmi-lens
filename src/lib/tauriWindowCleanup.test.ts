import { describe, expect, it } from 'vitest'

import { shouldCloseWebviewAfterAuthCleanup } from './tauriWindowCleanup'

describe('shouldCloseWebviewAfterAuthCleanup', () => {
  it('preserves app-owned windows that must survive auth cleanup', () => {
    expect(shouldCloseWebviewAfterAuthCleanup('main')).toBe(false)
    expect(shouldCloseWebviewAfterAuthCleanup('overlay')).toBe(false)
  })

  it('closes temporary non-app webviews', () => {
    expect(shouldCloseWebviewAfterAuthCleanup('auth')).toBe(true)
    expect(shouldCloseWebviewAfterAuthCleanup('oauth-popup')).toBe(true)
  })
})
