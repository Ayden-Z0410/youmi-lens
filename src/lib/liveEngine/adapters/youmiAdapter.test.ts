import { describe, expect, it } from 'vitest'
import { isFatalStreamErrorCode } from './youmiAdapter'

describe('isFatalStreamErrorCode', () => {
  it('treats beta-gate stream errors as non-recoverable', () => {
    expect(isFatalStreamErrorCode('auth_required')).toBe(true)
    expect(isFatalStreamErrorCode('daily_minutes_limit_reached')).toBe(true)
    expect(isFatalStreamErrorCode('session_limit_reached')).toBe(true)
  })

  it('keeps transient upstream failures reconnectable', () => {
    expect(isFatalStreamErrorCode('ws_connect_failed')).toBe(false)
    expect(isFatalStreamErrorCode('upstream_timeout')).toBe(false)
  })
})
