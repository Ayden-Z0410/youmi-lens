import { afterEach, describe, expect, it } from 'vitest'
import { Environment, Type } from '@apple/app-store-server-library'
import { environmentTryOrder, normalizeDecodedTransaction } from './iapApple.mjs'

const baseDecoded = {
  bundleId: 'com.aydenz.youmilensipad',
  environment: 'Sandbox',
  transactionId: 'tx-1',
  originalTransactionId: 'orig-1',
  productId: 'com.aydenz.youmilensipad.studentbasic30d',
  purchaseDate: Date.parse('2026-06-10T12:00:00Z'),
  expiresDate: Date.parse('2099-01-01T00:00:00Z'),
  type: Type.CONSUMABLE,
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
  it('accepts a valid consumable Student Basic transaction', () => {
    expect(normalize()).toMatchObject({
      productId: 'com.aydenz.youmilensipad.studentbasic30d',
      transactionId: 'tx-1',
      originalTransactionId: 'orig-1',
      purchaseDate: '2026-06-10T12:00:00.000Z',
      appleExpiresDate: '2099-01-01T00:00:00.000Z',
      productType: Type.CONSUMABLE,
    })
  })

  it('keeps the legacy Student Pass non-consumable compatible', () => {
    expect(normalize({
      productId: 'com.aydenz.youmilensipad.studentpass30d',
      type: Type.NON_CONSUMABLE,
    })).toMatchObject({
      productId: 'com.aydenz.youmilensipad.studentpass30d',
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

  it('rejects a mismatched non-consumable type for the new product', () => {
    expect(() => normalize({ type: Type.NON_CONSUMABLE })).toThrow(/type/)
  })

  it('rejects auto-renewable subscription transactions', () => {
    expect(() => normalize({ type: Type.AUTO_RENEWABLE_SUBSCRIPTION })).toThrow(/type/)
  })
})

describe('environmentTryOrder', () => {
  const original = process.env.APPLE_IAP_ENVIRONMENT
  afterEach(() => {
    if (original === undefined) delete process.env.APPLE_IAP_ENVIRONMENT
    else process.env.APPLE_IAP_ENVIRONMENT = original
  })

  it('attempts both Production and Sandbox so one backend serves TestFlight + App Store', () => {
    delete process.env.APPLE_IAP_ENVIRONMENT // default (Sandbox preferred)
    const order = environmentTryOrder()
    expect(order).toContain(Environment.PRODUCTION)
    expect(order).toContain(Environment.SANDBOX)
    expect(new Set(order).size).toBe(order.length) // de-duplicated
  })

  it('prefers the configured environment first', () => {
    process.env.APPLE_IAP_ENVIRONMENT = 'Production'
    expect(environmentTryOrder()[0]).toBe(Environment.PRODUCTION)
    expect(environmentTryOrder()).toContain(Environment.SANDBOX)

    process.env.APPLE_IAP_ENVIRONMENT = 'Sandbox'
    expect(environmentTryOrder()[0]).toBe(Environment.SANDBOX)
    expect(environmentTryOrder()).toContain(Environment.PRODUCTION)
  })
})
