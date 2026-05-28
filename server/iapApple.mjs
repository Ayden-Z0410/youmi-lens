import { readFileSync } from 'node:fs'
import {
  AppStoreServerAPIClient,
  Environment,
  SignedDataVerifier,
} from '@apple/app-store-server-library'

export const PRODUCT_PLAN_MAP = {
  'com.aydenz.youmilensipad.basic.monthly': 'student_basic',
  'com.aydenz.youmilensipad.plus.monthly': 'student_plus',
  'com.aydenz.youmilensipad.pro.monthly': 'student_pro',
}

export const PLAN_PRIORITY = {
  student_basic: 1,
  student_plus: 2,
  student_pro: 3,
}

const VALID_ENVIRONMENTS = new Set([
  Environment.SANDBOX,
  Environment.PRODUCTION,
  Environment.XCODE,
  Environment.LOCAL_TESTING,
])

let verifier = null
let apiClient = null

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

function normalizeApplePrivateKey(value) {
  return value.replace(/\\n/g, '\n')
}

function appleEnvironment() {
  const raw = process.env.APPLE_IAP_ENVIRONMENT?.trim() || Environment.SANDBOX
  const match = Object.values(Environment).find((value) => value.toLowerCase() === raw.toLowerCase())
  if (!match || !VALID_ENVIRONMENTS.has(match)) {
    throw new Error('APPLE_IAP_ENVIRONMENT must be Sandbox, Production, Xcode, or LocalTesting')
  }
  return match
}

function loadRootCertificates() {
  const certs = []
  const paths = process.env.APPLE_IAP_ROOT_CERTIFICATE_PATHS
    ?.split(',')
    .map((p) => p.trim())
    .filter(Boolean) ?? []
  for (const path of paths) certs.push(readFileSync(path))

  const base64Certs = process.env.APPLE_IAP_ROOT_CERTIFICATES_BASE64
    ?.split(',')
    .map((p) => p.trim())
    .filter(Boolean) ?? []
  for (const encoded of base64Certs) certs.push(Buffer.from(encoded, 'base64'))

  if (certs.length === 0) {
    throw new Error('Apple root certificates are not configured')
  }
  return certs
}

function getVerifier() {
  if (verifier) return verifier
  const environment = appleEnvironment()
  const bundleId = requiredEnv('APPLE_BUNDLE_ID')
  const appAppleIdRaw = process.env.APPLE_APP_APPLE_ID?.trim()
  const appAppleId = appAppleIdRaw ? Number(appAppleIdRaw) : undefined
  if (environment === Environment.PRODUCTION && !Number.isFinite(appAppleId)) {
    throw new Error('APPLE_APP_APPLE_ID is required for Production verification')
  }
  verifier = new SignedDataVerifier(
    loadRootCertificates(),
    process.env.APPLE_IAP_ENABLE_ONLINE_CHECKS !== 'false',
    environment,
    bundleId,
    appAppleId,
  )
  return verifier
}

function getApiClient() {
  if (apiClient) return apiClient
  apiClient = new AppStoreServerAPIClient(
    normalizeApplePrivateKey(requiredEnv('APPLE_IAP_PRIVATE_KEY')),
    requiredEnv('APPLE_IAP_KEY_ID'),
    requiredEnv('APPLE_IAP_ISSUER_ID'),
    requiredEnv('APPLE_BUNDLE_ID'),
    appleEnvironment(),
  )
  return apiClient
}

function isoFromAppleMs(ms) {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

function activeStatus(decoded) {
  if (decoded.revocationDate) return 'revoked'
  if (decoded.expiresDate && decoded.expiresDate <= Date.now()) return 'expired'
  return 'active'
}

function normalizeDecodedTransaction(decoded) {
  const productId = decoded.productId
  const planType = PRODUCT_PLAN_MAP[productId]
  if (!planType) throw new Error('Transaction product is not a Youmi Lens plan')

  const expectedBundleId = requiredEnv('APPLE_BUNDLE_ID')
  if (decoded.bundleId !== expectedBundleId) {
    throw new Error('Transaction bundle identifier does not match this app')
  }

  const expectedEnvironment = appleEnvironment()
  if (decoded.environment !== expectedEnvironment) {
    throw new Error('Transaction environment does not match server configuration')
  }

  if (!decoded.transactionId) throw new Error('Verified transaction is missing transactionId')

  const status = activeStatus(decoded)
  return {
    productId,
    planType,
    transactionId: decoded.transactionId,
    originalTransactionId: decoded.originalTransactionId ?? decoded.transactionId,
    environment: decoded.environment,
    expiresAt: isoFromAppleMs(decoded.expiresDate),
    revokedAt: isoFromAppleMs(decoded.revocationDate),
    status,
    rawTransaction: decoded,
  }
}

export async function fetchSignedTransactionInfo(transactionId) {
  if (!transactionId || typeof transactionId !== 'string') {
    throw new Error('transactionId is required')
  }
  const response = await getApiClient().getTransactionInfo(transactionId)
  if (!response?.signedTransactionInfo) {
    throw new Error('Apple did not return signed transaction info')
  }
  return response.signedTransactionInfo
}

export async function verifyAppleTransaction(input = {}) {
  // A bare transactionId only proves a purchase exists once the server looks it
  // up; it does not prove the authenticated caller owns that purchase. Require
  // StoreKit's client-supplied signed JWS and use transactionId only below as a
  // consistency check against the verified payload.
  const signedTransactionInfo = input.signedTransactionInfo || input.purchaseToken

  if (!signedTransactionInfo || typeof signedTransactionInfo !== 'string') {
    throw new Error('signedTransactionInfo or purchaseToken is required')
  }

  const decoded = await getVerifier().verifyAndDecodeTransaction(signedTransactionInfo)
  const normalized = normalizeDecodedTransaction(decoded)

  if (input.productId && input.productId !== normalized.productId) {
    throw new Error('Client productId does not match verified transaction')
  }
  if (input.transactionId && input.transactionId !== normalized.transactionId) {
    throw new Error('Client transactionId does not match verified transaction')
  }
  if (
    input.originalTransactionId &&
    input.originalTransactionId !== normalized.originalTransactionId
  ) {
    throw new Error('Client originalTransactionId does not match verified transaction')
  }

  return normalized
}

export function highestActivePlan(plans) {
  return plans.reduce((best, candidate) => {
    if (!candidate || candidate.status !== 'active') return best
    if (!best) return candidate
    return PLAN_PRIORITY[candidate.planType] > PLAN_PRIORITY[best.planType] ? candidate : best
  }, null)
}
