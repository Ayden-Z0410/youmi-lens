/**
 * Username validation must agree with the Website's mirror
 * (landing/app/profileFields.js) on BOTH the rules and the copy, since the desktop
 * and the Website hit the same backend and the same unique index.
 */
import { describe, expect, it } from 'vitest'
import {
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  validateUsername,
} from './username'
// The Website's mirror is plain ESM — vitest imports it directly, so this test
// compares against the real shipped contract rather than a restatement of it.
import {
  USERNAME_MAX_LENGTH as WEB_MAX,
  USERNAME_MIN_LENGTH as WEB_MIN,
  validateUsername as webValidateUsername,
} from '../../../landing/app/profileFields.js'

describe('username contract matches the Website', () => {
  it('uses the same length bounds', () => {
    expect(USERNAME_MIN_LENGTH).toBe(WEB_MIN)
    expect(USERNAME_MAX_LENGTH).toBe(WEB_MAX)
    expect(USERNAME_MIN_LENGTH).toBe(2)
    expect(USERNAME_MAX_LENGTH).toBe(64)
  })

  const cases: string[] = [
    '',
    '   ',
    'a',
    'ab',
    '  ab  ',
    'Ayden',
    'Ayden Zhang',
    '张三',
    'a'.repeat(64),
    'a'.repeat(65),
    'bad\u0000name',
    'bad\u007fname',
    'tab\tname',
  ]

  it.each(cases)('agrees with the Website for %j', (raw) => {
    const mine = validateUsername(raw)
    const web = webValidateUsername(raw)
    expect(mine.ok).toBe(web.ok)
    if (mine.ok && web.ok) {
      expect(mine.value).toBe(web.value)
    } else if (!mine.ok && !web.ok) {
      expect(mine.message).toBe(web.message)
    }
  })
})

describe('normalization', () => {
  it('trims but preserves inner spaces, case, and Unicode', () => {
    const r = validateUsername('  Ayden 张  ')
    expect(r).toEqual({ ok: true, value: 'Ayden 张' })
  })
})
