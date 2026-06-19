import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const IPAD_REPO = process.env.IPAD_REPO_PATH || '/Users/summer/Documents/youmi-lens-ipad'
const PRODUCT_ID = 'com.aydenz.youmilensipad.studentbasic30d'
const LEGACY_PRODUCT_ID = 'com.aydenz.youmilensipad.studentpass30d'

function backend(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

function ipad(path) {
  return readFileSync(join(IPAD_REPO, path), 'utf8')
}

describe('Phase 4 backend/iPad IAP API contract', () => {
  const routes = backend('./iapRoutes.mjs')
  const apple = backend('./iapApple.mjs')
  const purchases = ipad('lib/purchases.ts')
  const planStatus = ipad('lib/planStatus.ts')

  it('uses the consumable Student Basic product across backend and iPad active code', () => {
    expect(purchases).toContain(`STUDENT_PASS_PRODUCT_ID = '${PRODUCT_ID}'`)
    expect(apple).toContain(`STUDENT_BASIC_PRODUCT_ID = '${PRODUCT_ID}'`)
    expect(apple).toContain(`LEGACY_STUDENT_PASS_PRODUCT_ID = '${LEGACY_PRODUCT_ID}'`)
    expect(apple).toContain('Type.CONSUMABLE')
    expect(apple).toContain('Type.NON_RENEWING_SUBSCRIPTION')
    expect(routes).toContain("plan_type: product.plan_type")
  })

  it('matches verify route, method, auth, and request field names', () => {
    expect(routes).toContain('handleIapVerify')
    expect(purchases).toContain('/api/iap/apple/verify')
    expect(purchases).toContain("method: 'POST'")
    expect(purchases).toContain('Authorization: `Bearer ${accessToken}`')
    expect(purchases).toContain('platform: \'ios\'')
    expect(purchases).toContain('productId: STUDENT_PASS_PRODUCT_ID')
    expect(purchases).toContain('transactionId: transactionIdFor(purchase)')
    expect(purchases).toContain('originalTransactionId: originalTransactionIdFor(purchase)')
    expect(purchases).toContain('purchaseToken')
    expect(apple).toContain('input.signedTransactionInfo ||')
    expect(apple).toContain('input.purchaseToken ||')
  })

  it('keeps consumable access refresh backend-first without StoreKit restoration', () => {
    expect(routes).toContain('handleIapRestore')
    expect(purchases.indexOf('const initial = await this.getBackendEntitlement(accessToken)')).toBeGreaterThan(0)
    expect(purchases).not.toContain('discoverStudentPassTransactions')
    expect(purchases).not.toContain('/api/iap/restore')
  })

  it('matches enhanced inactive entitlement response shape', () => {
    expect(routes).toContain("status: 'none'")
    expect(routes).toContain("status: 'active'")
    expect(routes).toContain('currentEntitlement')
    expect(routes).toContain('latestEntitlement')
    expect(purchases).toContain("'expired'")
    expect(purchases).toContain("'revoked'")
    expect(purchases).toContain("'refunded'")
    expect(planStatus).toContain('latestEntitlement?:')
  })

  it('matches quota status fields used by the paywall', () => {
    const quota = backend('./betaUsageStatus.mjs')
    expect(quota).toContain('studentPass')
    expect(quota).toContain('maxProcessingJobsPerDay')
    expect(planStatus).toContain('studentPass?:')
    expect(planStatus).toContain('maxProcessingJobsPerDay?:')
  })

  it('keeps deleted-account ownership private in user-facing code', () => {
    expect(routes).not.toContain('linked to a deleted Youmi Lens account')
    expect(purchases).not.toContain('linked to a deleted Youmi Lens account')
    expect(purchases).toContain('This purchase is linked to another Youmi Lens account.')
  })
})
