# Student Pass Release Runbook And Test Prep

Do not execute this runbook until App Store Connect setup, production migration approval, and deployment approval are explicitly given.

## Migration-Transition Strategy

Selected strategy: Option A, backend compatibility layer.

Why:

- The updated backend can be deployed before the table rename.
- It resolves exactly one Apple IAP ledger before affected IAP reads/writes.
- It falls back to `public.app_store_subscriptions` only when `public.apple_iap_transactions` is confirmed absent by a narrow missing-table error.
- It never dual-writes.
- It fails closed when both ledgers exist, neither ledger exists, or a permission, RLS, missing-column, constraint, duplicate-key, malformed-query, timeout, network, or general database error prevents safe resolution.
- It centralizes ledger access in `server/iapLedger.mjs`, so fallback behavior is auditable and later removable.

Rejected strategy: temporary compatibility view.

- A simple view would not safely preserve all existing reads/writes/deletes.
- Updatable views with INSTEAD OF triggers would add migration complexity exactly during the risky interval.
- RLS and service-role behavior through a compatibility view would need separate validation.
- It risks making two names appear write-capable at once, which is contrary to the single-ledger rule.

Compatibility behavior:

- If only `app_store_subscriptions` exists, the compatible backend can resolve the legacy ledger name in limited compatibility mode. New Student Pass verification and transaction writes fail safely; do not activate Student Pass sales in this mode.
- If only `apple_iap_transactions` exists, it uses the new ledger.
- If both exist unexpectedly, the backend treats this as split-brain and fails closed. Stop deployment immediately; do not guess which table is authoritative.
- If neither exists, it fails closed.
- Account deletion uses the same abstraction. On the new ledger it marks `owner_state = 'account_deleted'` before auth deletion. On the legacy ledger, deletion may proceed only when the user has no legacy billing rows; if billing rows exist, deletion is temporarily blocked with a safe user-facing message.
- Cache behavior: there is no sticky legacy table cache. Each affected operation re-probes both table names, so a migration is detected on the next call. Process restart clears all in-memory state. Split-brain and no-ledger states always fail closed.

Accepted fallback conditions:

- PostgreSQL `42P01` undefined table.
- PostgREST `PGRST205` schema-cache table-not-found error that explicitly says the table could not be found in the schema cache.

Never-fallback conditions:

- Missing column.
- Permission denied.
- RLS failure.
- Constraint failure.
- Duplicate key.
- Malformed query.
- Timeout.
- Network error.
- Supabase outage.
- Any other general database error.

## Migration Preflight Expected Results

Run `docs/student-pass-migration-preflight.sql` before applying `supabase-migration-student-pass-entitlements.sql`.

Expected:

- `public.app_store_subscriptions` exists before first production migration.
- `public.apple_iap_transactions` is null before first production migration, unless a prior partial attempt occurred.
- Legacy ledger row count is understood and recorded.
- `duplicate_transaction_id_groups = 0`.
- Duplicate `original_transaction_id` groups are either `0` or explicitly reviewed as legitimate family/renewal history. V1 Student Pass should normally have no duplicate original transaction IDs for the same non-renewing purchase claim.
- `null_or_malformed_transaction_ids = 0`.
- Legacy `plan_type` values are only known historical values and can be migrated into the widened check constraint.
- Legacy `status` values are compatible with `active`, `expired`, or `revoked`, or have a documented mapping before migration.
- `orphaned_user_ids = 0`, or a deliberate retention/anonymization decision exists before adding FKs.
- `user_quota` plan types are within the Phase 4 allowed set.
- No conflicting table, policy, trigger, index, or constraint exists with a different definition from the migration.
- `gen_random_uuid_available = true`.
- If `billing_products` already exists, the Student Pass row matches product ID, `student_pass`, non-renewing kind, `30` entitlement days, and `sales_end_at = 2026-07-19T00:00:00Z`.

Abort conditions:

- Both `app_store_subscriptions` and `apple_iap_transactions` exist with rows and no reconciled migration plan.
- Duplicate `transaction_id` rows exist.
- Null, blank, or malformed transaction IDs exist.
- Orphaned ledger user IDs exist without an explicit retention fix.
- Existing plan/status values would violate migration check constraints.
- Existing policies/triggers/indexes/constraints conflict with the migration and cannot be safely replaced.
- `gen_random_uuid()` is unavailable.
- Any SQL in the migration has drifted from the backend code contract.

## Coordinated Deployment Runbook

### A. Keep Sales Disabled

- Confirm `billing_products.is_purchasable` is false or the table/row does not exist yet.
- Do not create the live App Store Connect product yet.
- Do not create a TestFlight Student Pass build yet.
- Do not apply the Supabase migration yet.
- Do not enable paid sales.

### B. Verify Git Branches And Commits

Commands to run locally before touching production:

```bash
git -C /Users/summer/Documents/youmi-lens status --short --branch
git -C /Users/summer/Documents/youmi-lens log --oneline --decorate -8
git -C /Users/summer/Documents/youmi-lens-ipad status --short --branch
git -C /Users/summer/Documents/youmi-lens-ipad log --oneline --decorate -8
npm --prefix /Users/summer/Documents/youmi-lens test
npm --prefix /Users/summer/Documents/youmi-lens run typecheck
npm --prefix /Users/summer/Documents/youmi-lens run build
npm --prefix /Users/summer/Documents/youmi-lens-ipad run test:phase3
cd /Users/summer/Documents/youmi-lens-ipad && npx tsc --noEmit
cd /Users/summer/Documents/youmi-lens-ipad && npx expo config --type public
```

Expected branches:

- Backend: `feat/student-pass-phase1-schema`.
- iPad: `main`.

### C. Verify Railway Environment Without Printing Secrets

Confirm presence only:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APPLE_IAP_PRIVATE_KEY`
- `APPLE_IAP_KEY_ID`
- `APPLE_IAP_ISSUER_ID`
- `APPLE_APP_APPLE_ID`
- `APPLE_BUNDLE_ID`
- `APPLE_IAP_ROOT_CERTIFICATE_PATHS` or `APPLE_IAP_ROOT_CERTIFICATES_BASE64`
- `APPLE_IAP_ENVIRONMENT`
- Student Pass quota variables if overriding defaults
- Railway/public API configuration

### D. Deploy Compatibility Backend Before Migration

Deploy the backend containing `server/iapLedger.mjs` before migration, after approval and from the backend repo:

```bash
git -C /Users/summer/Documents/youmi-lens rev-parse HEAD
railway variables
railway up
```

Do not print secret values in logs, shell history, tickets, or reports.

### E. Smoke-Test Compatibility Backend Against Legacy Database

```bash
curl -fsS "$API_BASE_URL/api/health"
curl -fsS -H "Authorization: Bearer $TEST_USER_JWT" "$API_BASE_URL/api/quota/status"
curl -fsS -H "Authorization: Bearer $TEST_USER_JWT" "$API_BASE_URL/api/iap/entitlement"
curl -fsS -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TEST_USER_JWT" \
  -d '{"platform":"ios","purchases":[]}' \
  "$API_BASE_URL/api/iap/restore"
```

Expected before migration:

- Free-user quota paths work.
- Account deletion test user with no legacy billing rows still completes.
- Account deletion with legacy billing rows is temporarily blocked before auth deletion.
- No Student Pass sale can activate in legacy mode.
- IAP verification fails safely if billing product/migration tables are unavailable.
- IAP verification must not partially write Student Pass data to `app_store_subscriptions`.
- Restore endpoint remains available and does not expose ledger internals.
- Ledger logs may show legacy limited mode; they must not show secret values.

### F. Run Read-Only Supabase Preflight

Run `docs/student-pass-migration-preflight.sql` in Supabase SQL editor or with a read-only database connection:

```bash
psql "$SUPABASE_READONLY_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f /Users/summer/Documents/youmi-lens/docs/student-pass-migration-preflight.sql
```

Abort if both tables exist, neither table exists, or production data fails any preflight check. If both ledger tables appear at any point, stop and do not continue automatically.

### G. Backup / Snapshot

- Confirm Supabase PITR/snapshot status.
- Export schema and critical billing tables if available.
- Record current Railway deployment ID/version.
- Record legacy ledger row count for post-migration parity.

### H. Apply Database Migration

Apply only after compatible backend smoke tests pass:

```bash
psql "$SUPABASE_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f /Users/summer/Documents/youmi-lens/supabase-migration-student-pass-entitlements.sql
```

### I. Run Post-Migration Validation

- Confirm row-count parity from old estimated/recorded count to `apple_iap_transactions`.
- Confirm `apple_iap_transactions`, `billing_products`, `user_entitlements`, `billing_events`, and `apple_iap_notifications`.
- Confirm `app_store_subscriptions` no longer exists as a table.
- Confirm constraints:
  - `apple_iap_transactions_transaction_id_key`
  - `apple_iap_transactions_owner_state_check`
  - `user_entitlements_status_check`
  - `apple_iap_notifications_processing_status_check`
- Confirm RLS enabled on public billing tables.
- Confirm seed product row:
  - product ID `com.aydenz.youmilensipad.studentpass30d`
  - `plan_type = student_pass`
  - `entitlement_days = 30`
  - `is_purchasable = false`
  - `sales_end_at = 2026-07-19T00:00:00Z`
- Confirm notification ledger uniqueness/deduplication.
- Confirm user entitlements constraints and RLS.
- Confirm only `apple_iap_transactions` exists as the Apple transaction ledger.

### J. Restart Or Redeploy Railway To Clear Compatibility State

The compatibility layer does not keep a sticky legacy cache, but restart/redeploy anyway to clear all process-local state and confirm the backend resolves only the new ledger.

### K. Post-Migration Backend Smoke Tests

Run:

```bash
curl -fsS "$API_BASE_URL/api/health"
curl -fsS -H "Authorization: Bearer $TEST_USER_JWT" "$API_BASE_URL/api/quota/status"
curl -fsS -H "Authorization: Bearer $TEST_USER_JWT" "$API_BASE_URL/api/iap/entitlement"
curl -fsS -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TEST_USER_JWT" \
  -d '{"platform":"ios","purchases":[]}' \
  "$API_BASE_URL/api/iap/restore"
curl -fsS -X POST -H "Content-Type: application/json" \
  -d '{"signedPayload":"bad"}' \
  "$API_BASE_URL/api/iap/apple/notifications" || true
```

Confirm:

- Backend uses `apple_iap_transactions`.
- Backend fails closed if `app_store_subscriptions` reappears.
- No writes go to `app_store_subscriptions`.
- Entitlement endpoint returns `status: none` for a no-purchase test user.
- Quota status returns Student Pass purchase metadata and free quota fields.
- Free users can still upload/process within quota.
- Restore endpoint remains available.
- Notification endpoint rejects malformed signed payloads safely.
- Refund/revoke notification processing is ready for signed Apple payloads.
- Account deletion marks ledger binding state on the new table before auth-user deletion.

### L. Later Production Steps

Only after all backend migration checks pass:

- Create the App Store Connect product.
- Create a TestFlight build.
- Run StoreKit Local and Sandbox purchase/restore/cancel/refund/revoke tests.
- Keep `is_purchasable=false` until Sandbox and TestFlight tests pass.
- Only after explicit approval may `is_purchasable` become true.

### M. Rollback

Before migration:

- Abort freely.
- Keep compatible backend deployed or roll back to the previous backend if no migration is planned.
- Since sales remain disabled, no new Student Pass purchases should exist.

After migration:

- Do not blindly rename tables back if any Apple transactions may have been written after migration.
- If backend is unhealthy, redeploy the compatibility backend commit; it supports old-only and new-only states.
- If data is wrong, stop purchase/restore write paths, preserve logs, and restore from Supabase snapshot/PITR.
- If table rename rollback is required, first confirm no new rows were written to `apple_iap_transactions` after the migration timestamp.
- If both ledger tables exist during rollback, stop immediately and reconcile manually from backup and row-count evidence.
- Never create a second active Apple transaction ledger.

## App Store Connect Preparation Checklist

Do not create the product until production rollout approval.

- Type: Non-Renewing Subscription
- Reference Name: `Student Pass 30 Days`
- Product ID: `com.aydenz.youmilensipad.studentpass30d`
- Display Name: `Student Pass – 30 Days`
- Description: `30 days of premium access. One-time payment. Does not renew automatically.`
- US price target: `$4.99`
- Availability regions: start with United States unless a broader launch is explicitly approved.
- Review screenshot: iPad paywall showing Student Pass, localized price, Restore Purchases, 30-day wording, one-time payment wording, and no auto-renewing language.
- App Review notes: explain this is a non-renewing subscription for 30 days of premium access, verified by backend, with Restore Purchases available from Plans and Settings.
- Sandbox testers: create at least two Sandbox Apple IDs for purchase/restore/cross-account tests.
- App Store Server Notification V2 URL:
  - Sandbox: `https://<railway-domain>/api/iap/apple/notifications`
  - Production: same path on production backend after env is switched to Production.
- Notification URL strategy: use one production backend URL only after it validates both Sandbox and Production environments according to deployment stage; do not point live App Store traffic at a local or staging URL.
- Paid Apps Agreement: must be active.
- Banking: must be complete.
- Tax forms: must be complete.

## End-To-End Test Matrix

### StoreKit Local

- Product fetch: Student Pass appears from `YoumiLens.storekit`.
- Localized price: paywall shows StoreKit metadata, not a hardcoded price.
- Purchase success: backend verify succeeds in local-compatible environment and entitlement becomes active.
- User cancellation: no backend grant, no local access.
- Backend verification failure: transaction is not treated as paid access.
- Restore active purchase: backend-first restore shows active pass.
- Expired result: backend enhanced entitlement status shows `Your Student Pass has expired.`
- `is_purchasable=false`: purchase button hidden/disabled; Restore remains visible.

### Apple Sandbox

- Real Sandbox purchase: Apple sheet completes for `com.aydenz.youmilensipad.studentpass30d`.
- Backend JWS verification: backend validates signature, bundle ID, environment, product ID, type, transaction ID, and purchaseDate.
- Purchase before cutoff: active 30-day entitlement granted.
- Purchase after cutoff: backend rejects with `sales_closed`.
- Reinstall restore: same Youmi Lens account restores through backend entitlement without requiring StoreKit rediscovery.
- Device change restore: same account on another iPad restores through backend entitlement.
- Apple-paid/backend-unseen crash scenario:
  - Start a purchase in Sandbox.
  - Let Apple purchase complete.
  - Interrupt before backend verification by enabling network loss, force-quitting immediately after the StoreKit success callback, or using a debug build breakpoint before `POST /api/iap/apple/verify`.
  - Relaunch and run Restore.
  - If StoreKit exposes a signed historical transaction, backend verifies and grants/marks expired as appropriate.
  - If StoreKit does not expose it, UI must say `Restore could not recover the purchase` or `No eligible Student Pass was found` depending backend state.
- Refund: App Store Server Notification V2 REFUND revokes entitlement.
- Revoke: App Store Server Notification V2 REVOKE revokes entitlement.
- Duplicate notification: duplicate UUID dedupes idempotently.
- Cross-account claim: same transaction on another Youmi Lens account returns safe account-binding error.

### TestFlight

- Product availability: App Store Connect product appears in real metadata.
- Real UI: paywall copy, price, loading, unavailable, purchase, restore, and entitlement states render correctly.
- Purchase messaging: success only after backend confirmation.
- Restore messaging: active, expired, refunded/revoked, no eligible purchase, account binding, and recovery failure messages.
- Free-plan fallback: expired pass resolves to public trial without cron.
- Paid quota enforcement: Student Pass limits apply server-side.
- Expiry fallback: after 30 days or controlled short entitlement duration in a non-production test product/database, access falls back to free quotas.

## StoreKit Local Static Validation

Allowed Phase 5A claim: StoreKit configuration JSON was statically validated.

Current static expectations:

- `storekit/YoumiLens.storekit` contains one non-renewing subscription.
- Product ID is `com.aydenz.youmilensipad.studentpass30d`.
- Display name is `Student Pass – 30 Days`.
- Description is `30 days of premium access. One-time payment. Does not renew automatically.`
- Local test price is `4.99`.
- No legacy Basic / Plus / Pro product IDs remain in the StoreKit JSON.

If no simulator/device StoreKit session is run, these remain untested:

- Product sheet opening.
- Purchase listener.
- Cancellation.
- Successful transaction flow.
- Restore flow.

## Notification Readiness

- Endpoint: `POST /api/iap/apple/notifications`.
- Expected notification version: App Store Server Notifications V2 with `signedPayload`.
- Verification: `SignedDataVerifier.verifyAndDecodeNotification`.
- Bundle/environment: enforced through Apple verifier configuration.
- REFUND: handled and records `refund` billing event.
- REVOKE: handled and records `revoke` billing event.
- Duplicate UUID: `apple_iap_notifications.notification_uuid` primary key and `reserveNotification` dedupe/retry behavior.
- Retry behavior: failed notification rows can be retried; processed/processing duplicates return `deduped`.
- Logging: no full signedPayload/JWS/JWT/private key in logs.
- Required Railway env vars:
  - `APPLE_BUNDLE_ID`
  - `APPLE_APP_APPLE_ID` for Production
  - `APPLE_IAP_ENVIRONMENT`
  - `APPLE_IAP_ROOT_CERTIFICATE_PATHS` or `APPLE_IAP_ROOT_CERTIFICATES_BASE64`
  - App Store Server API key env vars for transaction lookup: `APPLE_IAP_PRIVATE_KEY`, `APPLE_IAP_KEY_ID`, `APPLE_IAP_ISSUER_ID`
  - Supabase env vars listed below

## Environment Checklist

Backend/Railway:

- `SUPABASE_URL`: documented but not verifiable.
- `SUPABASE_SERVICE_ROLE_KEY`: documented but not verifiable; must be server-only.
- `APPLE_IAP_PRIVATE_KEY`: documented but not verifiable; manual configuration required.
- `APPLE_IAP_KEY_ID`: documented but not verifiable; manual configuration required.
- `APPLE_IAP_ISSUER_ID`: documented but not verifiable; manual configuration required.
- `APPLE_APP_APPLE_ID`: documented but not verifiable; manual configuration required for Production.
- `APPLE_BUNDLE_ID`: present locally in `.env.example` as expected `com.aydenz.youmilensipad`; deployed value not verifiable.
- Apple root certificates: documented via `APPLE_IAP_ROOT_CERTIFICATE_PATHS` or `APPLE_IAP_ROOT_CERTIFICATES_BASE64`; manual configuration required.
- Apple environment: documented via `APPLE_IAP_ENVIRONMENT`; manual configuration required.
- Student Pass quota variables: present locally in `.env.example`; defaults present in code; deployed overrides not verifiable.
- Railway/public API configuration: documented but not verifiable from repo.
- Sales cutoff/product settings: present locally in migration; production row missing until migration is applied.

iPad/EAS:

- API base URL: documented through `EXPO_PUBLIC_API_BASE_URL`; EAS value not verifiable from repo.
- `EXPO_PUBLIC_USE_REAL_IAP`: documented; EAS value not verifiable from repo.
- Bundle ID: present locally in `app.json` as `com.aydenz.youmilensipad`.
- Product ID: present locally in `lib/purchases.ts` and StoreKit JSON.
- StoreKit configuration: present locally at `storekit/YoumiLens.storekit`.
- EAS environment configuration: documented but not verifiable from repo.
- Apple server secrets in client: no `APPLE_IAP_PRIVATE_KEY`, `APPLE_IAP_KEY_ID`, or `APPLE_IAP_ISSUER_ID` references found in the iPad source review.
