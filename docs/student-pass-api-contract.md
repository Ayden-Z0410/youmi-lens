# Youmi Lens Student Pass API Contract

Phase 4 contract for backend, iPad, migration, and manual test preparation. The backend is the source of truth for paid access.

## Product

- Product ID: `com.aydenz.youmilensipad.studentpass30d`
- Apple type: Non-Renewing Subscription
- Backend plan type: `student_pass`
- Entitlement window: `starts_at = Apple verified purchaseDate`; `expires_at = starts_at + billing_products.entitlement_days`
- Apple `expiresDate` is informational only and may be stored as `apple_expires_date`

## Authentication

All account-bound endpoints require:

- Header: `Authorization: Bearer <Supabase user JWT>`
- Error shape: `{ "ok": false, "error": "<code>", "message": "<safe message>" }`
- Missing/invalid JWT uses `401` with `auth_required`

## POST /api/iap/apple/verify

Client request:

```json
{
  "platform": "ios",
  "productId": "com.aydenz.youmilensipad.studentpass30d",
  "transactionId": "<StoreKit transaction id>",
  "originalTransactionId": "<StoreKit original transaction id>",
  "purchaseToken": "<StoreKit 2 signed transaction JWS>"
}
```

Accepted signed transaction aliases:

- `purchaseToken`
- `signedTransactionInfo`
- `transactionId` when the backend can fetch signed transaction info from Apple

Backend verification requirements:

- Apple JWS signature verifies through `SignedDataVerifier`
- Bundle ID matches `APPLE_BUNDLE_ID`
- Environment matches `APPLE_IAP_ENVIRONMENT`
- Decoded transaction ID, original transaction ID, product ID, product type, and purchase date are authoritative
- Client-supplied IDs must match decoded Apple fields when supplied

Success response:

```json
{
  "ok": true,
  "granted": true,
  "planType": "student_pass",
  "entitlement": {
    "active": true,
    "productId": "com.aydenz.youmilensipad.studentpass30d",
    "expiresAt": "2026-07-10T12:00:00.000Z"
  },
  "quotaStatus": { "planType": "student_pass" }
}
```

Inactive but processed response examples:

- Expired: `200`, `{ "ok": true, "granted": false, "reason": "expired", ... }`
- Purchase after cutoff: `403`, `{ "ok": false, "granted": false, "reason": "sales_closed", ... }`
- Unknown product: `200`, `{ "ok": false, "granted": false, "reason": "unknown_product", ... }`
- Transaction already bound to another account: `409`, `{ "ok": false, "error": "iap_already_linked", "message": "This App Store purchase is already linked to another account." }`
- Transaction bound to a deleted account: `409`, `{ "ok": false, "error": "iap_deleted_account_binding", "message": "This App Store purchase is linked to another account." }`

The iPad app must not grant access unless the backend returns `ok: true` and `granted: true`.

## POST /api/iap/restore

Client request:

```json
{
  "platform": "ios",
  "purchases": [
    {
      "productId": "com.aydenz.youmilensipad.studentpass30d",
      "transactionId": "<StoreKit transaction id>",
      "originalTransactionId": "<StoreKit original transaction id>",
      "purchaseToken": "<StoreKit 2 signed transaction JWS>"
    }
  ]
}
```

Restore order on iPad:

1. `GET /api/iap/entitlement`
2. StoreKit recovery discovery only if backend has no active/expired/revoked/refunded state
3. `POST /api/iap/restore` for discovered signed transactions
4. Final `GET /api/iap/entitlement`

Response:

```json
{
  "ok": true,
  "planType": "student_pass",
  "entitlement": { "active": true, "productId": "com.aydenz.youmilensipad.studentpass30d", "expiresAt": "..." },
  "quotaStatus": { "planType": "student_pass" },
  "restoredCount": 1,
  "activeRestoredCount": 1,
  "alreadyLinked": false
}
```

When `alreadyLinked` is true, the iPad shows a generic account-binding message and must not expose whether the previous owner account was deleted.

## GET /api/iap/entitlement

Response for active entitlement:

```json
{
  "ok": true,
  "entitlement": {
    "active": true,
    "status": "active",
    "productId": "com.aydenz.youmilensipad.studentpass30d",
    "planType": "student_pass",
    "startsAt": "2026-06-10T12:00:00.000Z",
    "expiresAt": "2026-07-10T12:00:00.000Z",
    "currentEntitlement": {
      "productId": "com.aydenz.youmilensipad.studentpass30d",
      "planType": "student_pass",
      "startsAt": "2026-06-10T12:00:00.000Z",
      "expiresAt": "2026-07-10T12:00:00.000Z",
      "status": "active"
    },
    "latestEntitlement": {
      "productId": "com.aydenz.youmilensipad.studentpass30d",
      "planType": "student_pass",
      "startsAt": "2026-06-10T12:00:00.000Z",
      "expiresAt": "2026-07-10T12:00:00.000Z",
      "status": "active"
    }
  }
}
```

Response for latest expired entitlement:

```json
{
  "ok": true,
  "entitlement": {
    "active": false,
    "status": "expired",
    "productId": "com.aydenz.youmilensipad.studentpass30d",
    "planType": "student_pass",
    "expiresAt": "2026-07-10T12:00:00.000Z",
    "currentEntitlement": null,
    "latestEntitlement": {
      "productId": "com.aydenz.youmilensipad.studentpass30d",
      "planType": "student_pass",
      "startsAt": "2026-06-10T12:00:00.000Z",
      "expiresAt": "2026-07-10T12:00:00.000Z",
      "status": "active"
    }
  }
}
```

Response for latest refunded/revoked entitlement:

```json
{
  "ok": true,
  "entitlement": {
    "active": false,
    "status": "refunded",
    "productId": "com.aydenz.youmilensipad.studentpass30d",
    "planType": "student_pass",
    "expiresAt": "2026-07-10T12:00:00.000Z",
    "currentEntitlement": null,
    "latestEntitlement": {
      "productId": "com.aydenz.youmilensipad.studentpass30d",
      "planType": "student_pass",
      "startsAt": "2026-06-10T12:00:00.000Z",
      "expiresAt": "2026-07-10T12:00:00.000Z",
      "status": "revoked"
    }
  }
}
```

Response for no known Student Pass:

```json
{
  "ok": true,
  "entitlement": {
    "active": false,
    "status": "none",
    "productId": null,
    "planType": null,
    "expiresAt": null,
    "currentEntitlement": null,
    "latestEntitlement": null
  }
}
```

This endpoint never exposes transactions owned by another account or by a deleted account.

## GET /api/quota/status

The Plans screen uses this endpoint through `fetchPlanStatus`.

Key fields:

- `plan.planType`
- `plan.displayName`
- `plan.status`
- `plan.unlimited`
- `plan.entitlement.active`
- `plan.entitlement.productId`
- `plan.entitlement.expiresAt`
- `plan.studentPass.productId`
- `plan.studentPass.isPurchasable`
- `plan.studentPass.salesEndAt`
- `plan.minutesLimit`
- `plan.dailyMinutesLimit`
- `plan.maxRecordingMinutes`
- `plan.maxLiveSessionMinutes`
- `plan.maxRecordingsPerDay`
- `plan.maxProcessingJobsPerDay`

All dates are ISO 8601 UTC strings.

## iPad Restore Messages

- Active: `Active Student Pass restored.`
- Expired: `Your Student Pass has expired.`
- Refunded/revoked: `This purchase was refunded or revoked.`
- No known/recoverable purchase: `No eligible Student Pass was found.`
- Another account binding: `This purchase is linked to another Youmi Lens account.`
- Recovery failure: `Restore could not recover the purchase.`
