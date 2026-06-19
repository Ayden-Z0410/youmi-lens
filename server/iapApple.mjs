/**
 * Apple App Store server-side verification for Youmi Lens.
 *
 * Active product: Student Basic 30 Days (a CONSUMABLE purchase). The legacy
 * Student Pass NON-RENEWING SUBSCRIPTION remains verifiable for existing transactions.
 * modern, Apple-supported JWS path (@apple/app-store-server-library):
 *   - SignedDataVerifier.verifyAndDecodeTransaction  — signed StoreKit 2 txns
 *   - SignedDataVerifier.verifyAndDecodeNotification — App Store Server Notif. V2
 *   - AppStoreServerAPIClient.getTransactionInfo     — fetch a signed txn by id
 *
 * The DECODED Apple transaction is authoritative. We never trust client-supplied
 * productId / transactionId / purchaseDate / expiry / plan type / status; any
 * client value passed in must MATCH the decoded value or we reject.
 *
 * IMPORTANT: this module performs NO entitlement decision. The 30-day window is
 * computed by the backend from the verified purchaseDate (see iapEntitlements
 * + iapRoutes). Apple's `expiresDate` is surfaced only as informational metadata.
 *
 * Secrets (private key, JWS, JWT) are never logged here or by callers.
 */
import { readFileSync } from 'node:fs'
import {
  AppStoreServerAPIClient,
  Environment,
  SignedDataVerifier,
  Type,
} from '@apple/app-store-server-library'

const VALID_ENVIRONMENTS = new Set([
  Environment.SANDBOX,
  Environment.PRODUCTION,
  Environment.XCODE,
  Environment.LOCAL_TESTING,
])
export const STUDENT_BASIC_PRODUCT_ID = 'com.aydenz.youmilensipad.studentbasic30d'
export const LEGACY_STUDENT_PASS_PRODUCT_ID = 'com.aydenz.youmilensipad.studentpass30d'
const SUPPORTED_PRODUCT_TYPES = new Map([
  [STUDENT_BASIC_PRODUCT_ID, Type.CONSUMABLE],
  [LEGACY_STUDENT_PASS_PRODUCT_ID, Type.NON_RENEWING_SUBSCRIPTION],
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

/** The Apple environment this server is configured to accept (Sandbox vs Production). */
export function appleEnvironment() {
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

/**
 * Normalize a verified, decoded Apple transaction into our internal shape.
 *
 * Pure (no I/O) so it is directly unit-testable: callers pass a decoded payload
 * plus the expected bundle id / environment. Validates signature-independent
 * invariants: bundle id, environment, and the presence of transactionId /
 * productId / purchaseDate. Does NOT map a plan or decide active/expired — that
 * is the backend's job from billing_products + the computed window.
 *
 * @param {object} decoded  JWSTransactionDecodedPayload (already signature-verified)
 * @param {{ expectedBundleId: string, expectedEnvironment: string }} config
 */
export function normalizeDecodedTransaction(decoded, { expectedBundleId, expectedEnvironment }) {
  if (!decoded || typeof decoded !== 'object') {
    throw new Error('Decoded transaction is missing')
  }
  if (decoded.bundleId !== expectedBundleId) {
    throw new Error('Transaction bundle identifier does not match this app')
  }
  if (decoded.environment !== expectedEnvironment) {
    // Rejects e.g. a Sandbox transaction when the server is configured Production.
    throw new Error('Transaction environment does not match server configuration')
  }
  if (!decoded.transactionId) throw new Error('Verified transaction is missing transactionId')
  if (!decoded.productId) throw new Error('Verified transaction is missing productId')
  if (typeof decoded.purchaseDate !== 'number' || !Number.isFinite(decoded.purchaseDate)) {
    throw new Error('Verified transaction is missing purchaseDate')
  }
  const expectedProductType = SUPPORTED_PRODUCT_TYPES.get(decoded.productId)
  if (!expectedProductType) {
    throw new Error('Verified transaction product is not supported')
  }
  if (decoded.type !== expectedProductType) {
    throw new Error('Verified transaction type does not match the supported product')
  }

  return {
    productId: decoded.productId,
    transactionId: decoded.transactionId,
    originalTransactionId: decoded.originalTransactionId ?? decoded.transactionId,
    environment: decoded.environment,
    productType: decoded.type ?? null,
    purchaseDateMs: decoded.purchaseDate,
    purchaseDate: isoFromAppleMs(decoded.purchaseDate),
    // Apple `expiresDate` is informational only. Stored as apple_expires_date;
    // never used for the fixed 30-day entitlement.
    appleExpiresDate: isoFromAppleMs(decoded.expiresDate),
    revokedAt: isoFromAppleMs(decoded.revocationDate),
    revoked: Boolean(decoded.revocationDate),
    rawTransaction: decoded,
  }
}

/** Fetch a signed transaction by id from the App Store Server API (used by restore). */
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

/**
 * Verify + decode a StoreKit 2 signed transaction (the authoritative path).
 * Accepts either the JWS directly (signedTransactionInfo / purchaseToken) or a
 * transactionId we can look up via the App Store Server API. Any client-supplied
 * productId / transactionId / originalTransactionId must match the decoded values.
 */
export async function verifyAppleTransaction(input = {}) {
  const signedTransactionInfo =
    input.signedTransactionInfo ||
    input.purchaseToken ||
    (input.transactionId ? await fetchSignedTransactionInfo(input.transactionId) : null)

  if (!signedTransactionInfo || typeof signedTransactionInfo !== 'string') {
    throw new Error('signedTransactionInfo or purchaseToken is required')
  }

  const decoded = await getVerifier().verifyAndDecodeTransaction(signedTransactionInfo)
  const normalized = normalizeDecodedTransaction(decoded, {
    expectedBundleId: requiredEnv('APPLE_BUNDLE_ID'),
    expectedEnvironment: appleEnvironment(),
  })

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

/**
 * Verify + decode an App Store Server Notification V2 `signedPayload` and, when
 * present, the embedded signed transaction. Returns a compact, audit-safe shape.
 * Environment on the notification must match the server configuration.
 */
export async function verifyAppleNotification(signedPayload) {
  if (!signedPayload || typeof signedPayload !== 'string') {
    throw new Error('signedPayload is required')
  }
  const decoded = await getVerifier().verifyAndDecodeNotification(signedPayload)
  const expectedEnvironment = appleEnvironment()
  const env = decoded?.data?.environment
  if (env && env !== expectedEnvironment) {
    throw new Error('Notification environment does not match server configuration')
  }

  let transaction = null
  const signedTransactionInfo = decoded?.data?.signedTransactionInfo
  if (signedTransactionInfo) {
    const decodedTx = await getVerifier().verifyAndDecodeTransaction(signedTransactionInfo)
    transaction = normalizeDecodedTransaction(decodedTx, {
      expectedBundleId: requiredEnv('APPLE_BUNDLE_ID'),
      expectedEnvironment,
    })
  }

  return {
    notificationType: decoded?.notificationType ?? null,
    subtype: decoded?.subtype ?? null,
    notificationUUID: decoded?.notificationUUID ?? null,
    environment: env ?? expectedEnvironment,
    transaction,
  }
}
