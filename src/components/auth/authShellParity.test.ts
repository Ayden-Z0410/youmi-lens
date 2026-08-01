/**
 * Guardrail: the desktop auth stylesheet must stay byte-identical to the Website's.
 *
 * The whole point of this round is that Desktop and Website render the SAME auth
 * surface. src/styles/auth-shell.css is a copy of landing/app/auth-shell.css, and a
 * copy silently drifts. This test fails the moment either side is edited alone, so
 * a future change has to be made in landing/ and re-copied — keeping the Website as
 * the single source of truth rather than letting the desktop fork the design.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const websiteCss = readFileSync(
  new URL('../../../landing/app/auth-shell.css', import.meta.url),
  'utf8',
)
const desktopCss = readFileSync(new URL('../../styles/auth-shell.css', import.meta.url), 'utf8')

describe('auth-shell.css parity with the production Website', () => {
  it('is byte-identical to landing/app/auth-shell.css', () => {
    expect(desktopCss).toBe(websiteCss)
  })

  it('still carries the desktop-only .compact modifier the app relies on', () => {
    // AuthScreens applies `.compact` for window-driven sizing; if the Website ever
    // drops these rules the desktop layout silently loses its narrow-window treatment.
    expect(desktopCss).toMatch(/\.yl-auth-surface\.compact\s*\{[^}]*grid-template-columns:\s*42%/)
    expect(desktopCss).toMatch(/\.yl-auth-surface\.compact\s*\{[^}]*min-height:\s*560px/)
  })

  it('keeps the approved palette the product decision pinned', () => {
    // #0B1F3B primary + the navy panel gradient are the confirmed values for this
    // round. A change here is a brand change, not a refactor.
    expect(desktopCss).toMatch(/--yl-primary:\s*#0B1F3B/i)
    expect(desktopCss).toMatch(/--yl-navy1:\s*#1A2B47/i)
    expect(desktopCss).toMatch(/--yl-navy2:\s*#101B2D/i)
  })

  it('defines its tokens on .yl-auth-surface so the desktop can render it directly', () => {
    // The desktop does NOT render the Website's outer .yl-auth wrapper, so the
    // custom properties must also be declared on the surface itself.
    const tokenBlock = desktopCss.slice(0, desktopCss.indexOf('--yl-container-radius'))
    expect(tokenBlock).toContain('.yl-auth-surface')
  })
})
