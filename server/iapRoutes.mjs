import { createClient } from '@supabase/supabase-js'
import { buildQuotaStatus } from './betaUsageStatus.mjs'
import {
  BETA_ERROR_CODES,
  getOrCreateUserQuota,
  quotaPatchForPlan,
} from './betaGate.mjs'
import { highestActivePlan, verifyAppleTransaction } from './iapApple.mjs'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

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

function subscriptionPayload(user, verified) {
  return {
    user_id: user.userId,
    product_id: verified.productId,
    plan_type: verified.planType,
    transaction_id: verified.transactionId,
    original_transaction_id: verified.originalTransactionId,
    environment: verified.environment,
    status: verified.status,
    expires_at: verified.expiresAt,
    revoked_at: verified.revokedAt,
    auto_renew_status: null,
    raw_transaction: verified.rawTransaction,
    raw_renewal_info: null,
    last_verified_at: new Date().toISOString(),
  }
}

async function ensureTransactionNotBoundToAnotherUser(db, userId, verified) {
  const { data: byTransaction, error: txErr } = await db
    .from('app_store_subscriptions')
    .select('user_id')
    .eq('transaction_id', verified.transactionId)
    .maybeSingle()
  if (txErr) throw txErr
  if (byTransaction && byTransaction.user_id !== userId) {
    throw new Error('This App Store transaction is already linked to another account')
  }

  const { data: byOriginal, error: originalErr } = await db
    .from('app_store_subscriptions')
    .select('user_id')
    .eq('original_transaction_id', verified.originalTransactionId)
    .limit(1)
  if (originalErr) throw originalErr
  if (byOriginal?.[0] && byOriginal[0].user_id !== userId) {
    throw new Error('This App Store subscription is already linked to another account')
  }
}

async function upsertSubscription(db, user, verified) {
  await ensureTransactionNotBoundToAnotherUser(db, user.userId, verified)
  const { data, error } = await db
    .from('app_store_subscriptions')
    .upsert(subscriptionPayload(user, verified), { onConflict: 'transaction_id' })
    .select('*')
    .single()
  if (error) throw error
  return data
}

async function syncUserQuotaToPlan(db, user, planType) {
  await getOrCreateUserQuota(user.userId, user.email)
  const { error } = await db
    .from('user_quota')
    .update({
      ...quotaPatchForPlan(planType),
      email: (user.email || '').toLowerCase(),
    })
    .eq('user_id', user.userId)
  if (error) throw error
}

function safeIapError(err) {
  const message = err instanceof Error ? err.message : 'IAP verification failed'
  if (
    message.includes('not configured') ||
    message.includes('root certificates') ||
    message.includes('APPLE_')
  ) {
    return { status: 503, error: 'iap_not_configured', message: 'In-app purchase verification is not configured.' }
  }
  if (message.includes('already linked')) {
    return { status: 409, error: 'iap_already_linked', message }
  }
  return { status: 400, error: 'iap_verification_failed', message: 'Purchase could not be verified.' }
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
    const verified = await verifyAppleTransaction(req.body)
    await upsertSubscription(db, user, verified)
    if (verified.status !== 'active') {
      res.status(403).json({
        ok: false,
        error: 'inactive_subscription',
        message: 'The verified App Store subscription is not active.',
        status: verified.status,
      })
      return
    }

    await syncUserQuotaToPlan(db, user, verified.planType)
    const quotaStatus = await buildQuotaStatus(user.userId, user.email)
    res.json({ ok: true, planType: verified.planType, quotaStatus })
  } catch (err) {
    console.warn(
      '[iap/verify] failed',
      JSON.stringify({
        userIdPrefix: user.userId.slice(0, 8),
        productId: req.body?.productId ?? null,
        transactionId: req.body?.transactionId ?? null,
        message: err instanceof Error ? err.message : String(err),
      }),
    )
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

  if (purchases.length === 0) {
    const quotaStatus = await buildQuotaStatus(user.userId, user.email)
    res.json({
      ok: true,
      planType: quotaStatus?.planType ?? null,
      quotaStatus,
      message: 'No purchases were provided to restore.',
    })
    return
  }

  const db = makeAdminClient()
  if (!db) {
    res.status(503).json({ ok: false, error: 'server_not_configured', message: 'Server database is not configured.' })
    return
  }

  const verifiedPurchases = []
  const errors = []
  for (const purchase of purchases) {
    try {
      const verified = await verifyAppleTransaction(purchase)
      await upsertSubscription(db, user, verified)
      verifiedPurchases.push(verified)
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }

  const best = highestActivePlan(verifiedPurchases)
  try {
    if (best) await syncUserQuotaToPlan(db, user, best.planType)
    const quotaStatus = await buildQuotaStatus(user.userId, user.email)
    res.json({
      ok: true,
      planType: best?.planType ?? quotaStatus?.planType ?? null,
      quotaStatus,
      restoredCount: verifiedPurchases.length,
      activeRestoredCount: verifiedPurchases.filter((p) => p.status === 'active').length,
      ignoredCount: errors.length,
    })
  } catch (err) {
    const safe = safeIapError(err)
    res.status(safe.status).json({ ok: false, error: safe.error, message: safe.message })
  }
}
