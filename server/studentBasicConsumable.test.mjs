import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { grantEntitlement } from './iapRoutes.mjs'

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

describe('Student Basic consumable grant safety', () => {
  const migration = read('../supabase-migration-student-basic-consumable.sql')
  const routes = read('./iapRoutes.mjs')

  it('creates one entitlement per transaction and returns an existing replay', () => {
    expect(migration).toContain('WHERE source_transaction_id = p_source_transaction_id')
    expect(migration.indexOf('WHERE source_transaction_id = p_source_transaction_id'))
      .toBeLessThan(migration.indexOf('INSERT INTO public.user_entitlements'))
    expect(migration).toContain('RETURN v_entitlement')
  })

  it('serializes per-user extensions and chains from the latest expiry', () => {
    expect(migration).toContain('pg_advisory_xact_lock')
    expect(migration).toContain('SELECT max(expires_at)')
    expect(migration).toContain("plan_type = 'student_pass'")
    expect(migration).toContain('v_extension_base := greatest(')
    expect(migration).toContain('v_extension_base + pg_catalog.make_interval')
  })

  it('binds the entitlement to the verified transaction and current user', () => {
    expect(migration).toContain('v_transaction.user_id <> p_user_id')
    expect(migration).toContain('v_transaction.product_id <> p_product_id')
    expect(routes).toContain("db.rpc('grant_consumable_entitlement'")
    expect(routes).toContain("db.rpc('revoke_student_pass_entitlement'")
    expect(routes).toContain('p_user_id: userId')
    expect(routes).toContain('p_source_transaction_id: verified.transactionId')
  })

  it('recomputes remaining stacked consumables after a refund under the per-user lock', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.revoke_student_pass_entitlement')
    expect(migration).toContain('pg_advisory_xact_lock')
    expect(migration).toContain("SET status = 'revoked'")
    expect(migration).toContain("AND p.kind = 'consumable'")
    expect(migration).toContain('ORDER BY t.purchase_date, e.created_at, e.id')
    expect(migration).toContain('expires_at = v_extension_base + pg_catalog.make_interval')
  })

  it('routes a verified consumable purchase through the atomic grant function', async () => {
    const calls = []
    const row = {
      user_id: 'user-1',
      product_id: 'com.aydenz.youmilensipad.studentbasic30d',
      source_transaction_id: 'tx-1',
      starts_at: '2026-06-11T00:00:00.000Z',
      expires_at: '2026-07-11T00:00:00.000Z',
    }
    const db = {
      async rpc(name, args) {
        calls.push({ name, args })
        return { data: row, error: null }
      },
    }

    await expect(
      grantEntitlement(
        db,
        'user-1',
        {
          productId: row.product_id,
          transactionId: row.source_transaction_id,
          purchaseDate: row.starts_at,
        },
        { kind: 'consumable' },
        { startsAt: row.starts_at, expiresAt: row.expires_at },
      ),
    ).resolves.toEqual(row)

    expect(calls).toEqual([
      {
        name: 'grant_consumable_entitlement',
        args: {
          p_user_id: 'user-1',
          p_product_id: row.product_id,
          p_source_transaction_id: row.source_transaction_id,
          p_purchase_date: row.starts_at,
        },
      },
    ])
  })

  it('keeps the new product closed while preserving the legacy product row', () => {
    expect(migration).toContain("'com.aydenz.youmilensipad.studentbasic30d'")
    expect(migration).toContain("'com.aydenz.youmilensipad.studentpass30d'")
    expect(migration).not.toContain('DELETE FROM public.billing_products')
  })
})
