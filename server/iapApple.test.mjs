import { describe, expect, it } from 'vitest'
import { Type } from '@apple/app-store-server-library'
import { normalizeDecodedTransaction } from './iapApple.mjs'

const baseDecoded = {
  bundleId: 'com.aydenz.youmilensipad',
  environment: 'Sandbox',
  transactionId: 'tx-1',
  originalTransactionId: 'orig-1',
  productId: 'com.aydenz.youmilensipad.studentpass30d',
  purchaseDate: Date.parse('2026-06-10T12:00:00Z'),
  expiresDate: Date.parse('2099-01-01T00:00:00Z'),
  type: Type.NON_CONSUMABLE,
}

function normalize(decoded = {}) {
  return normalizeDecodedTransaction(
    { ...baseDecoded, ...decoded },
    {
      expectedBundleId: 'com.aydenz.youmilensipad',
      expectedEnvironment: 'Sandbox',
    },
  )
}

describe('normalizeDecodedTransaction', () => {
  it('accepts a valid non-consumable Student Pass transaction', () => {
    expect(normalize()).toMatchObject({
      productId: 'com.aydenz.youmilensipad.studentpass30d',
      transactionId: 'tx-1',
      originalTransactionId: 'orig-1',
      purchaseDate: '2026-06-10T12:00:00.000Z',
      appleExpiresDate: '2099-01-01T00:00:00.000Z',
      productType: Type.NON_CONSUMABLE,
    })
  })

  it('rejects wrong bundle ID', () => {
    expect(() => normalize({ bundleId: 'com.example.other' })).toThrow(/bundle identifier/)
  })

  it('rejects wrong environment', () => {
    expect(() => normalize({ environment: 'Production' })).toThrow(/environment/)
  })

  it('rejects a missing purchaseDate', () => {
    expect(() => normalize({ purchaseDate: undefined })).toThrow(/purchaseDate/)
  })

  it('rejects unknown product IDs', () => {
    expect(() => normalize({ productId: 'com.example.other' })).toThrow(/not supported/)
  })

  it('rejects non-renewing subscription transactions', () => {
    expect(() => normalize({ type: Type.NON_RENEWING_SUBSCRIPTION })).toThrow(/non-consumable/)
  })

  it('rejects auto-renewable subscription transactions', () => {
    expect(() => normalize({ type: Type.AUTO_RENEWABLE_SUBSCRIPTION })).toThrow(/non-consumable/)
  })
})
