import { describe, expect, it } from 'vitest'
import { verifyAppleTransaction } from './iapApple.mjs'

describe('verifyAppleTransaction', () => {
  it('rejects transaction-id-only verification requests', async () => {
    await expect(verifyAppleTransaction({ transactionId: 'victim-transaction-id' })).rejects.toThrow(
      'signedTransactionInfo or purchaseToken is required',
    )
  })
})
