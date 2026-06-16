/**
 * Student Basic IAP routes (server is the source of truth).
 *
 *   POST /api/iap/apple/verify         — verify a StoreKit 2 signed transaction,
 *                                        grant a server-computed 30-day window.
 *   GET  /api/iap/entitlement          — current effective entitlement.
 *   POST /api/iap/restore              — re-verify + restore prior purchases.
 *   POST /api/iap/apple/notifications  — App Store Server Notifications V2
 *                                        (REFUND / REVOKE → revoke entitlement).
 *   POST /api/iap/verify               — legacy alias for /api/iap/apple/verify.
 *
 * The decoded Apple transaction is authoritative; entitlement windows are
 * computed by the backend from the verified purchaseDate. One Apple transaction
 * is bound to exactly one Youmi Lens account. Secrets/JWS/JWT are never logged.
 */
import { createClient } from '@supabase/supabase-js'
import { NotificationTypeV2 } from '@apple/app-store-server-library'
import { buildQuotaStatus } from './betaUsageStatus.mjs'
import { BETA_ERROR_CODES, getOrCreateUserQuota } from './betaGate.mjs'
import { verifyAppleTransaction, verifyAppleNotification } from './iapApple.mjs'
import {
  isAppleIapLedgerUnavailableError,
  insertAppleIapTransaction,
  updateAppleIapTransactionByTransactionId,
  revokeAppleIapTransaction,
} from './iapLedger.mjs'
import {
  decideGrantWithBinding,
  isEntitlementActive,
  loadBillingProduct,
  findTransactionBinding,
  findTransactionOwner,
  getActiveEntitlement,
  getEntitlementBySourceTransactionId,
  getLatestStackableEntitlementExpiry,
  getLatestStudentPassEntitlement,
  getLatestRevocationEventType,
  deriveInactiveEntitlementStatus,
  safeEntitlementSnapshot,
  recordBillingEvent,
  reserveNotification,
  markNotificationProcessed,
  markNotificationFailed,
} from './iapEntitlements.mjs'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

class AlreadyLinkedError extends Error {}
class DeletedAccountBindingError extends Error {}

function makeAdminClient() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return null
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function makeAnonClient(token) {
  if (!SUPABASE_URL || !ANON_KEY) return null
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

async function requireUser(req, res) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) {
    res.status(401).json({ ok: false, error: BETA_ERROR_CODES.AUTH_REQUIRED, message: 'Sign in required.' })
    return null
  }
  const anon = makeAnonClient(token)
  if (!anon) {
    res.status(503).json({ ok: false, error: 'server_not_configured', message: 'Server auth is not configured.' })
    return null
  }
  const { data, error } = await anon.auth.getUser(token)
  const user = data?.user
  if (error || !user?.id) {
    res.status(401).json({ ok: false, error: BETA_ERROR_CODES.AUTH_REQUIRED, message: 'Invalid or expired session.' })
    return null
  }
  return { userId: user.id, email: user.email || '' }
}

// ── DB writes (ownership-safe + idempotent) ──────────────────────────────────

function transactionRow(userId, verified, product, status) {
  return {
    user_id: userId,
    product_id: verified.productId,
    plan_type: product.plan_type,
    transaction_id: verified.transactionId,
    original_transaction_id: verified.originalTransactionId,
    environment: verified.environment,
    status,
    purchase_date: verified.purchaseDate,
    apple_expires_date: verified.appleExpiresDate,
    revoked_at: verified.revokedAt,
    raw_transaction: verified.rawTransaction,
    last_verified_at: new Date().toISOString(),
    owner_state: 'active',
    account_deleted_at: null,
  }
}

/**
 * Persist the verified transaction WITHOUT ever reassigning ownership. A
 * re-verify by the same user updates in place; a brand-new transaction is
 * inserted; a unique-violation race is resolved by re-reading the owner.
 */
async function persistTransaction(db, userId, verified, product, status, binding) {
  if (binding?.ownerState === 'account_deleted') {
    throw new DeletedAccountBindingError('deleted account binding')
  }
  if (binding?.userId === userId) {
    const { error } = await updateAppleIapTransactionByTransactionId(
      db,
      verified.transactionId,
      {
        status,
        purchase_date: verified.purchaseDate,
        apple_expires_date: verified.appleExpiresDate,
        revoked_at: verified.revokedAt,
        raw_transaction: verified.rawTransaction,
        last_verified_at: new Date().toISOString(),
        owner_state: 'active',
        account_deleted_at: null,
      },
    )
    if (error) throw error
    return
  }

  const { error } = await insertAppleIapTransaction(db, transactionRow(userId, verified, product, status))
  if (error) {
    if (error.code === '23505') {
      const latestBinding = await findTransactionBinding(db, verified)
      if (latestBinding?.ownerState === 'account_deleted') {
        throw new DeletedAccountBindingError('deleted account binding')
      }
      if (latestBinding?.userId && latestBinding.userId !== userId) throw new AlreadyLinkedError('already linked')
      return // concurrent insert by the same user — fine
    }
    throw error
  }
}

/** Grant an ACTIVE entitlement. Consumables stack atomically in PostgreSQL. */
export async function grantEntitlement(db, userId, verified, product, window) {
  if (product.kind === 'consumable') {
    const { data, error } = await db.rpc('grant_consumable_entitlement', {
      p_user_id: userId,
      p_product_id: verified.productId,
      p_source_transaction_id: verified.transactionId,
      p_purchase_date: verified.purchaseDate,
    })
    if (error) throw error
    return Array.isArray(data) ? data[0] ?? null : data
  }

  const { error } = await db
    .from('user_entitlements')
    .upsert(
      {
        user_id: userId,
        product_id: verified.productId,
        plan_type: product.plan_type,
        source_transaction_id: verified.transactionId,
        starts_at: window.startsAt,
        expires_at: window.expiresAt,
        status: 'active',
        revoked_at: null,
      },
      { onConflict: 'source_transaction_id' },
    )
  if (error) throw error
}

/** Mark an entitlement + its transaction revoked (refund / revoke). */
async function revokeByTransaction(db, transactionId, revokedAtIso) {
  const revoked_at = revokedAtIso || new Date().toISOString()
  const { error: entErr } = await db
    .from('user_entitlements')
    .update({ status: 'revoked', revoked_at })
    .eq('source_transaction_id', transactionId)
  if (entErr) throw entErr
  const { error: txErr } = await revokeAppleIapTransaction(db, transactionId, revoked_at)
  if (txErr) throw txErr
}

// ── Verify (core) ────────────────────────────────────────────────────────────

function safeIapError(err) {
  if (isAppleIapLedgerUnavailableError(err)) {
    return { status: 503, error: 'iap_temporarily_unavailable', message: 'In-app purchase service is temporarily unavailable.' }
  }
  if (
    ['42P01', 'PGRST205', '42501', '42703', '23514', 'PGRST100', '57014'].includes(String(err?.code ?? '')) ||
    /fetch failed|timeout|timed out/i.test(String(err?.message ?? ''))
  ) {
    return { status: 503, error: 'iap_temporarily_unavailable', message: 'In-app purchase service is temporarily unavailable.' }
  }
  if (err instanceof AlreadyLinkedError) {
    return { status: 409, error: 'iap_already_linked', message: 'This App Store purchase is already linked to another account.' }
  }
  if (err instanceof DeletedAccountBindingError) {
    return { status: 409, error: 'iap_deleted_account_binding', message: 'This App Store purchase is linked to another account.' }
  }
  const message = err instanceof Error ? err.message : 'IAP verification failed'
  if (message.includes('not configured') || message.includes('root certificates') || message.includes('APPLE_')) {
    return { status: 503, error: 'iap_not_configured', message: 'In-app purchase verification is not configured.' }
  }
  return { status: 400, error: 'iap_verification_failed', message: 'Purchase could not be verified.' }
}

/**
 * Verify one purchase payload and persist transaction + entitlement idempotently.
 * Returns { granted:boolean, code? } — throws on verification/DB failure.
 */
export async function verifyAndPersist(db, user, payload) {
  const verified = await verifyAppleTransaction(payload)
  const product = await loadBillingProduct(db, verified.productId)
  const binding = await findTransactionBinding(db, verified)
  const existingGrant = binding?.userId === user.userId
    ? await getEntitlementBySourceTransactionId(db, verified.transactionId)
    : null

  if (existingGrant) {
    const replayStatus = verified.revoked ? 'revoked' : existingGrant.status
    await persistTransaction(db, user.userId, verified, product, replayStatus, binding)
    if (verified.revoked) {
      await revokeByTransaction(db, verified.transactionId, verified.revokedAt)
      return { granted: false, code: 'revoked' }
    }
    return {
      granted: isEntitlementActive(existingGrant, Date.now()),
      code: 'idempotent_replay',
    }
  }

  const existingEntitlementExpiresAt = product?.kind === 'consumable'
    ? await getLatestStackableEntitlementExpiry(db, user.userId)
    : null

  const decision = decideGrantWithBinding({
    verified,
    product,
    binding,
    requestingUserId: user.userId,
    existingEntitlementExpiresAt,
    nowMs: Date.now(),
  })

  if (!decision.ok) {
    await recordBillingEvent(db, user.userId, decision.event)
    if (decision.code === 'already_linked') throw new AlreadyLinkedError(decision.message)
    if (decision.code === 'account_deleted') throw new DeletedAccountBindingError(decision.message)
    return { granted: false, code: decision.code, message: decision.message }
  }

  const ledgerStatus = decision.active ? 'active' : decision.entitlementStatus
  await persistTransaction(db, user.userId, verified, product, ledgerStatus, binding)

  if (decision.active) {
    await grantEntitlement(db, user.userId, verified, product, decision.window)
  }
  await recordBillingEvent(db, user.userId, { ...decision.event, event_type: 'verify_ok' })
  await recordBillingEvent(db, user.userId, decision.event)
  return { granted: decision.active, code: decision.active ? 'granted' : decision.entitlementStatus }
}

export async function handleIapVerify(req, res) {
  const user = await requireUser(req, res)
  if (!user) return
  if (req.body?.platform !== 'ios') {
    res.status(400).json({ ok: false, error: 'unsupported_platform', message: 'Only iOS purchases are supported.' })
    return
  }
  const db = makeAdminClient()
  if (!db) {
    res.status(503).json({ ok: false, error: 'server_not_configured', message: 'Server database is not configured.' })
    return
  }

  try {
    const result = await verifyAndPersist(db, user, req.body)
    const quotaStatus = await buildQuotaStatus(user.userId, user.email)
    if (!result.granted) {
      res.status(result.code === 'sales_closed' ? 403 : 200).json({
        ok: result.code !== 'sales_closed' && result.code !== 'unknown_product',
        granted: false,
        reason: result.code,
        message: result.message ?? null,
        planType: quotaStatus?.planType ?? null,
        entitlement: quotaStatus?.entitlement ?? null,
        quotaStatus,
      })
      return
    }
    res.json({
      ok: true,
      granted: true,
      planType: quotaStatus?.planType ?? null,
      entitlement: quotaStatus?.entitlement ?? null,
      quotaStatus,
    })
  } catch (err) {
    logIapFailure('verify', user, req.body, err)
    const safe = safeIapError(err)
    res.status(safe.status).json({ ok: false, error: safe.error, message: safe.message })
  }
}

export async function handleIapRestore(req, res) {
  const user = await requireUser(req, res)
  if (!user) return
  if (req.body?.platform !== 'ios') {
    res.status(400).json({ ok: false, error: 'unsupported_platform', message: 'Only iOS purchases are supported.' })
    return
  }

  const purchases = Array.isArray(req.body?.purchases)
    ? req.body.purchases
        .map((p) => {
          if (typeof p === 'string') return { signedTransactionInfo: p }
          if (!p || typeof p !== 'object') return null
          return {
            signedTransactionInfo: p.signedTransactionInfo,
            purchaseToken: p.purchaseToken,
            transactionId: p.transactionId,
            productId: p.productId,
            originalTransactionId: p.originalTransactionId ?? p.originalTransactionIdentifierIOS,
          }
        })
        .filter((p) => p && (p.signedTransactionInfo || p.purchaseToken || p.transactionId))
    : []

  const db = makeAdminClient()
  if (!db) {
    res.status(503).json({ ok: false, error: 'server_not_configured', message: 'Server database is not configured.' })
    return
  }

  // Ensure a quota row exists even when there is nothing to restore.
  await getOrCreateUserQuota(user.userId, user.email)

  let restoredActive = 0
  let restoredCount = 0
  let alreadyLinked = false
  for (const purchase of purchases) {
    try {
      const result = await verifyAndPersist(db, user, purchase)
      restoredCount += 1
      if (result.granted) restoredActive += 1
    } catch (err) {
      if (isAppleIapLedgerUnavailableError(err)) {
        logIapFailure('restore', user, purchase, err)
        const safe = safeIapError(err)
        res.status(safe.status).json({ ok: false, error: safe.error, message: safe.message })
        return
      }
      if (err instanceof AlreadyLinkedError || err instanceof DeletedAccountBindingError) alreadyLinked = true
      // Ignore individually unverifiable/expired purchases during restore.
    }
  }

  const quotaStatus = await buildQuotaStatus(user.userId, user.email)
  res.json({
    ok: true,
    planType: quotaStatus?.planType ?? null,
    entitlement: quotaStatus?.entitlement ?? null,
    quotaStatus,
    restoredCount,
    activeRestoredCount: restoredActive,
    alreadyLinked,
  })
}

export async function handleIapEntitlement(req, res) {
  const user = await requireUser(req, res)
  if (!user) return
  const db = makeAdminClient()
  if (!db) {
    res.status(503).json({ ok: false, error: 'server_not_configured', message: 'Server database is not configured.' })
    return
  }
  await getOrCreateUserQuota(user.userId, user.email)
  const entitlement = await getActiveEntitlement(db, user.userId, new Date().toISOString())
  if (!entitlement) {
    const latestEntitlement = await getLatestStudentPassEntitlement(db, user.userId)
    if (!latestEntitlement) {
      res.json({
        ok: true,
        entitlement: {
          active: false,
          status: 'none',
          productId: null,
          planType: null,
          expiresAt: null,
          currentEntitlement: null,
          latestEntitlement: null,
        },
      })
      return
    }
    const latestRevocationEventType = await getLatestRevocationEventType(db, latestEntitlement)
    const status = deriveInactiveEntitlementStatus(latestEntitlement, latestRevocationEventType)
    res.json({
      ok: true,
      entitlement: {
        active: false,
        status,
        productId: latestEntitlement.product_id,
        planType: latestEntitlement.plan_type,
        expiresAt: latestEntitlement.expires_at,
        currentEntitlement: null,
        latestEntitlement: safeEntitlementSnapshot(latestEntitlement),
      },
    })
    return
  }
  const currentEntitlement = safeEntitlementSnapshot(entitlement)
  res.json({
    ok: true,
    entitlement: {
      active: true,
      status: 'active',
      productId: entitlement.product_id,
      planType: entitlement.plan_type,
      startsAt: entitlement.starts_at,
      expiresAt: entitlement.expires_at,
      currentEntitlement,
      latestEntitlement: currentEntitlement,
    },
  })
}

// ── App Store Server Notifications V2 (no JWT; JWS-authenticated) ─────────────

const REVOKING_NOTIFICATIONS = new Set([NotificationTypeV2.REFUND, NotificationTypeV2.REVOKE])

export function billingEventTypeForRevokingNotification(notificationType) {
  if (notificationType === NotificationTypeV2.REFUND) return 'refund'
  if (notificationType === NotificationTypeV2.REVOKE) return 'revoke'
  return null
}

export async function handleAppleNotifications(req, res) {
  const signedPayload = req.body?.signedPayload
  if (!signedPayload || typeof signedPayload !== 'string') {
    res.status(400).json({ ok: false, error: 'invalid_notification', message: 'Missing signedPayload.' })
    return
  }

  const db = makeAdminClient()
  if (!db) {
    res.status(503).json({ ok: false, error: 'server_not_configured' })
    return
  }

  let decoded
  try {
    decoded = await verifyAppleNotification(signedPayload)
  } catch (err) {
    // Bad signature / wrong environment: do not process, do not leak details.
    console.warn('[iap/notifications] verify failed', JSON.stringify({ message: err instanceof Error ? err.message : String(err) }))
    res.status(400).json({ ok: false, error: 'invalid_notification' })
    return
  }

  try {
    const reservation = await reserveNotification(db, decoded)
    if (!reservation.reserved) {
      res.json({ ok: true, deduped: true })
      return
    }

    const tx = decoded.transaction
    const ownerUserId = tx ? await findTransactionOwner(db, tx) : null

    if (REVOKING_NOTIFICATIONS.has(decoded.notificationType) && tx) {
      // Preserve transaction + history; flip status to revoked.
      await revokeByTransaction(db, tx.transactionId, tx.revokedAt)
      await recordBillingEvent(db, ownerUserId, {
        event_type: billingEventTypeForRevokingNotification(decoded.notificationType),
        product_id: tx.productId,
        transaction_id: tx.transactionId,
        environment: decoded.environment,
        detail: { subtype: decoded.subtype ?? null },
      })
    }

    // Audit + dedupe marker (transaction_id carries the notificationUUID).
    await recordBillingEvent(db, ownerUserId, {
      event_type: 'notification',
      product_id: tx?.productId ?? null,
      transaction_id: decoded.notificationUUID ?? null,
      environment: decoded.environment,
      detail: { notificationType: decoded.notificationType, subtype: decoded.subtype ?? null },
    })
    await markNotificationProcessed(db, decoded.notificationUUID)

    res.json({ ok: true })
  } catch (err) {
    try {
      await markNotificationFailed(db, decoded?.notificationUUID, err)
    } catch (markErr) {
      console.warn('[iap/notifications] failed to mark notification failed', JSON.stringify({ message: markErr instanceof Error ? markErr.message : String(markErr) }))
    }
    console.error('[iap/notifications] processing failed', JSON.stringify({ message: err instanceof Error ? err.message : String(err) }))
    res.status(500).json({ ok: false, error: 'notification_processing_failed' })
  }
}

// ── Logging (never logs JWS/JWT/secrets) ─────────────────────────────────────

function logIapFailure(scope, user, body, err) {
  console.warn(
    `[iap/${scope}] failed`,
    JSON.stringify({
      userIdPrefix: user.userId.slice(0, 8),
      productId: body?.productId ?? null,
      transactionId: body?.transactionId ?? null,
      message: err instanceof Error ? err.message : String(err),
    }),
  )
}
