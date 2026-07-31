import { describe, expect, it } from 'vitest'
import { resolveExistingGrantReplay } from './iapRoutes.mjs'

const activeGrant = {
  status: 'active',
  revoked_at: null,
  expires_at: '2026-07-10T12:00:00.000Z',
}

describe('resolveExistingGrantReplay', () => {
  it('keeps same-user active replays idempotent', () => {
    expect(
      resolveExistingGrantReplay(
        activeGrant,
        { revoked: false },
        Date.parse('2026-06-11T00:00:00Z'),
      ),
    ).toMatchObject({
      granted: true,
      code: 'idempotent_replay',
      ledgerStatus: 'active',
      revoke: false,
    })
  })

  it('revokes stale active grants when Apple marks the replayed transaction revoked', () => {
    expect(
      resolveExistingGrantReplay(
        activeGrant,
        { revoked: true, revokedAt: '2026-06-15T00:00:00.000Z' },
        Date.parse('2026-06-11T00:00:00Z'),
      ),
    ).toMatchObject({
      granted: false,
      code: 'revoked',
      ledgerStatus: 'revoked',
      revoke: true,
    })
  })
})
