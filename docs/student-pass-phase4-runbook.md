# Student Pass Phase 4 Runbook And Test Prep

Do not execute this runbook until App Store Connect setup, production migration approval, and deployment approval are explicitly given.

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

1. Take database snapshot/backups.
   - Confirm Supabase PITR/snapshot status.
   - Export schema and critical billing tables if available.
   - Record current backend deployment version.

2. Run read-only preflight.
   - Execute `docs/student-pass-migration-preflight.sql`.
   - Save result output and notices.
   - Abort on any abort condition above.

3. Protect write paths.
   - Dangerous interval: after the table rename, old backend code using `app_store_subscriptions` will fail or write the wrong ledger.
   - Minimize by deploying a backend build that is compatible with the renamed ledger immediately after migration.
   - Best option: schedule a short maintenance window or temporarily disable purchase verification endpoints at the router/load-balancer level while migration runs.
   - Do not block Restore longer than the maintenance window; Restore must be available immediately after backend deploy.

4. Apply migration.
   - Apply `supabase-migration-student-pass-entitlements.sql`.
   - Do not run from an editor session with unreviewed modifications.

5. Run post-migration validation.
   - Confirm `app_store_subscriptions` is gone or renamed.
   - Confirm `apple_iap_transactions`, `billing_products`, `user_entitlements`, `billing_events`, and `apple_iap_notifications` exist.
   - Confirm RLS is enabled on public billing tables.
   - Confirm expected constraints, policies, triggers, and indexes.
   - Confirm Student Pass product row.

6. Deploy Phase 2/4 backend immediately.
   - Deploy backend containing renamed ledger references and enhanced entitlement status.
   - Confirm Railway env vars are present.

7. Backend smoke tests.
   - `GET /api/health` or equivalent health endpoint.
   - Authenticated `GET /api/quota/status` for a free user.
   - Authenticated `GET /api/iap/entitlement` for no-purchase user returns `status: none`.
   - Verification endpoint rejects bad/missing signed transaction safely.
   - Notification endpoint rejects malformed `signedPayload` safely.

8. Confirm free users still work.
   - Upload/record/process within free quota.
   - Quota denial still works after limits.

9. Confirm account deletion.
   - Delete test account.
   - Confirm Apple transaction history is retained with nullable `user_id` and binding state.
   - Confirm no `app_store_subscriptions` reference remains.

10. Confirm Restore remains available.
   - New purchases may be disabled by `is_purchasable=false`, but Restore endpoint and entitlement endpoint stay live.
   - Verify pre-cutoff transactions can still restore after sales stop.

11. Rollback plan.
   - If migration fails before commit, roll back transaction.
   - If migration succeeds but backend deploy fails, deploy the last known compatible Phase 2/4 backend immediately.
   - If data corruption is found, stop purchase/restore write paths, restore from snapshot/PITR, and preserve logs for reconciliation.
   - Never reintroduce a second active Apple transaction ledger.

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

- `SUPABASE_URL`: cannot verify from repo.
- `SUPABASE_ANON_KEY`: cannot verify from repo.
- `SUPABASE_SERVICE_ROLE_KEY`: cannot verify from repo; must be server-only.
- `APPLE_IAP_PRIVATE_KEY`: cannot verify from repo; must be secret.
- `APPLE_IAP_KEY_ID`: cannot verify from repo.
- `APPLE_IAP_ISSUER_ID`: cannot verify from repo.
- `APPLE_BUNDLE_ID`: expected `com.aydenz.youmilensipad`; `.env.example` documents it.
- `APPLE_APP_APPLE_ID`: required for Production; cannot verify from repo.
- `APPLE_IAP_ENVIRONMENT`: expected `Sandbox` before production testing, `Production` for production; cannot verify deployed value.
- `APPLE_IAP_ROOT_CERTIFICATE_PATHS` or `APPLE_IAP_ROOT_CERTIFICATES_BASE64`: cannot verify from repo.
- `APPLE_IAP_ENABLE_ONLINE_CHECKS`: optional; `.env.example` documents `true`.
- Student Pass quota env values: documented in `.env.example`; code has locked defaults.
- Sales cutoff/product settings: stored in `billing_products` migration row, not an env var.

iPad/EAS:

- `EXPO_PUBLIC_API_BASE_URL`: required; cannot verify EAS value from repo.
- `EXPO_PUBLIC_USE_REAL_IAP`: required `true` or `1` for real IAP builds; `.env` value is not printed here.
- Product ID: centralized in `lib/purchases.ts`.
- Apple secrets: none required and none should be present in client env.
