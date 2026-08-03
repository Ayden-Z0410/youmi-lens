import { describe, expect, it } from 'vitest'
import {
  billableMinutesFromDurationSec,
  checkUploadAllowed,
  parsePositiveDurationSec,
} from './betaGate.mjs'

describe('parsePositiveDurationSec', () => {
  it('accepts positive numbers and numeric strings', () => {
    expect(parsePositiveDurationSec(90)).toBe(90)
    expect(parsePositiveDurationSec('90')).toBe(90)
    expect(parsePositiveDurationSec('90.4')).toBe(90)
    expect(parsePositiveDurationSec('90.6')).toBe(91)
  })

  it('rejects omit / zero / negative / non-numeric (quota bypass vectors)', () => {
    expect(parsePositiveDurationSec(undefined)).toBeNull()
    expect(parsePositiveDurationSec(null)).toBeNull()
    expect(parsePositiveDurationSec('')).toBeNull()
    expect(parsePositiveDurationSec(0)).toBeNull()
    expect(parsePositiveDurationSec('0')).toBeNull()
    expect(parsePositiveDurationSec(-100)).toBeNull()
    expect(parsePositiveDurationSec('-5')).toBeNull()
    expect(parsePositiveDurationSec('abc')).toBeNull()
    expect(parsePositiveDurationSec(Number.NaN)).toBeNull()
    expect(parsePositiveDurationSec(Infinity)).toBeNull()
  })
})

describe('billableMinutesFromDurationSec', () => {
  it('never returns negative minutes', () => {
    expect(billableMinutesFromDurationSec(-3600)).toBe(0)
    expect(billableMinutesFromDurationSec(0)).toBe(0)
    expect(billableMinutesFromDurationSec(Number.NaN)).toBe(0)
  })

  it('ceil-bills positive durations with a 1-minute floor', () => {
    expect(billableMinutesFromDurationSec(1)).toBe(1)
    expect(billableMinutesFromDurationSec(60)).toBe(1)
    expect(billableMinutesFromDurationSec(61)).toBe(2)
    expect(billableMinutesFromDurationSec(3600)).toBe(60)
  })
})

describe('checkUploadAllowed duration fail-closed', () => {
  const trialQuota = {
    plan_type: 'public_trial',
    status: 'active',
  }

  it('blocks non-positive duration instead of skipping the gate', () => {
    const gate = checkUploadAllowed(trialQuota, 0)
    expect(gate.allowed).toBe(false)
    expect(gate.status).toBe(400)

    const neg = checkUploadAllowed(trialQuota, -120)
    expect(neg.allowed).toBe(false)
    expect(neg.status).toBe(400)
  })

  it('still enforces per-recording max when duration is present', () => {
    const gate = checkUploadAllowed(trialQuota, 61 * 60)
    expect(gate.allowed).toBe(false)
    expect(gate.status).toBe(403)
    expect(gate.body.error).toBe('recording_too_long')
  })

  it('allows an in-limit positive duration', () => {
    const gate = checkUploadAllowed(trialQuota, 30 * 60)
    expect(gate.allowed).toBe(true)
  })
})
