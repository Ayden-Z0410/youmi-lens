# Youmi Lens Website — Commercialization Production Runbook

Production Website source is `landing/`. Cloudflare Pages deploys that directory
from `main`. The Website commercialization work is intentionally not committed,
pushed, merged, or deployed until product-owner approval.

## Architecture and scope

The Website uses static folder pages, not an SPA router:

- `/pricing/`
- `/login/`
- `/register/`
- `/forgot-password/`
- `/reset-password/` (compatibility landing route)
- `/account/`

Each route has its own `index.html`, so direct navigation and refresh need no
rewrite. Shared ES modules live in `landing/app/`; `plans.js` is the single source
for Website plan names, prices, quotas, and plan codes.

`/` , `/pricing/`, and `/account/` render the marketing nav. The four auth routes
(`/login/`, `/register/`, `/forgot-password/`, `/reset-password/`) deliberately do
**not**: they are full-viewport pages that fill the whole screen with the
edge-to-edge navy|form split (`.yl-auth-full`), with no marketing toolbar, no
outer padding, no corner radius, and no shadow. The navy panel's Youmi Lens
wordmark links back to `/` so those pages are not a dead end.

The client contains only public configuration: the Supabase project URL, the
public anon key, and the Railway API origin. It contains no service-role key,
OAuth secret, Apple credential, Stripe secret, Brevo key, password, OTP, or
access token.

## Shared account behavior

- Identity and sessions: the existing Supabase project shared with Desktop/iPad.
- Registration: `check-email` → `send-signup-code` →
  `verify-signup-code-and-create-user` → `signInWithPassword`.
- Verification: the existing **8-digit** signup code.
- Recovery: `resetPasswordForEmail` → `verifyOtp({ type: 'recovery' })` →
  `updateUser`. The primary Website UX is an emailed recovery code, not a link.
- Account: authenticated `GET /api/quota/status` and
  `GET /api/subscription/status`.
- Billing: authenticated `POST /api/billing/checkout` and
  `POST /api/billing/portal`; the backend owns Stripe URLs and plan-code mapping.

## Audited production infrastructure (2026-07-26)

### Supabase

Project: `lbwsrnjbiayepshrdult`.

Current URL configuration (saved and verified 2026-07-26):

- Site URL: `https://youmilens.com`
- Existing redirects retained for native clients:
  - `lecturecompanion://auth-callback`
  - `https://youmi-lens-production.up.railway.app/tauri-auth-callback`
  - `youmilens://auth/callback`
  - `exp://*`

Website redirects (saved and verified):

- `https://youmilens.com/account/`
- `https://youmilens.com/reset-password/`

Local OAuth verification entries, retained until interactive testing is complete:

- `http://localhost:8080/account/`
- `http://localhost:8080/reset-password/`

Repository audit confirmed the Desktop, Tauri, Website, and native flows pass
explicit redirect targets, so the Site URL change to `https://youmilens.com` did
not replace any existing native redirect; all eight entries above are live.

The real Website recovery-OTP flow was verified end to end against a dedicated
test account: emailed 8-digit recovery code → `verifyOtp` → password update →
old password rejected → new password signs in → `/account/` renders Free Beta
with quota → logout returns the homepage to `Log in`.

Provider/session audit:

- signup enabled;
- email provider enabled;
- email confirmation enabled and `mailer_autoconfirm` disabled, compatible with
  the existing admin-confirmed 8-digit registration flow;
- recovery OTP: 8 digits, 3600-second Supabase expiry (email copy currently states
  a shorter user-facing window);
- Google provider enabled;
- Apple provider enabled for the native bundle only;
- refresh-token replay protection enabled with a 10-second reuse interval.

### Google OAuth

Google Cloud project: `youmi-lens-auth` (`Youmi Lens Auth`).

The Supabase Web client—not the separate Creator OS Drive client—contains the
exact callback:

`https://lbwsrnjbiayepshrdult.supabase.co/auth/v1/callback`

The consent screen is External/Testing with authorized test users. JavaScript
origins are not required for this server-mediated Supabase OAuth flow. Website
return routing is controlled by Supabase's additive allow-list above.

### Apple OAuth

The Supabase provider currently contains only the native client ID
`com.aydenz.youmilensipad`; the OAuth client-secret field is empty. A Website
Services ID, verified `youmilens.com` domain/return URL, and valid generated
client secret are required before Apple Website sign-in can succeed. Creating or
renewing those credentials requires authenticated Apple Developer account-holder
access. Do not rotate the existing native configuration.

### Cloudflare Pages

Project: `youmi-lens`, connected to `Ayden-Z0410/youmi-lens`.

- production branch: `main`;
- build command: empty;
- root directory: repository root;
- output directory: `landing`;
- custom domain: `youmilens.com`, active with HTTPS;
- automatic production deployments: enabled;
- no environment variables or deploy hooks;
- build-system version 3;
- cache-control on current static responses:
  `public, max-age=0, must-revalidate`.

`www.youmilens.com` is not configured (DNS does not resolve). The currently
deployed commit predates the folder pages, so Cloudflare's fallback presently
returns the homepage body for those paths — re-confirmed 2026-07-26: all seven
production routes return HTTP 200 but every one serves
`<title>Youmi Lens for Mac and Windows</title>`. After the approved
production-only Website commit reaches `main`, the existing `landing` output
setting will serve each folder page directly; no SPA rewrite is required.

Live response headers confirm `cache-control: public, max-age=0, must-revalidate`
and `cf-cache-status: DYNAMIC`, so authenticated Account API responses are not
edge-cached. Account data is fetched client-side from the Railway API with an
`Authorization` header and is never part of a cached static response.

### Stripe and Railway

Stripe sandbox contains one active `Student Basic` product with the approved
monthly `$4.99` and annual `$49.99` prices. The sandbox Customer Portal supports
invoice history, customer/payment details, and cancellation at period end.
There is no sandbox webhook destination.

The live Stripe account is not activated and has no launch-ready live prices.
Railway production does not currently define the Stripe secret, webhook secret,
monthly/annual price IDs, or Website return origin. Adding them would trigger a
backend redeploy and must wait for explicit deployment approval. Until then the
authenticated backend returns a safe unavailable/not-configured state; no client
secret or Stripe URL is synthesized in the Website.

## Production verification

Serve the same folder root locally:

```sh
python3 -m http.server 8080 --directory landing
```

Before deployment verify:

1. direct navigation and refresh for every route listed above;
2. registration with a real 8-digit email code;
3. password login, session refresh, and logout;
4. recovery OTP through password update and old-password rejection;
5. Google OAuth return to `/account/` after local redirects are allow-listed;
6. Account quota/subscription responses with a real safe test user;
7. Pricing at desktop, tablet, and mobile widths;
8. keyboard focus order, visible focus, console errors, and download links;
9. Apple only after the Website Services ID/client secret blocker is cleared;
10. checkout/portal only in Stripe test mode after Railway test configuration is
    safely available—never perform a real charge.

## Verified 2026-07-26 (automated, no credentials required)

Run against `http://localhost:8080` serving `landing/`, using headless Chrome
over CDP with true device emulation (plain `--headless --screenshot` ignores
`<meta viewport>` and reports false mobile overflow — do not use it):

- **Routes** — all 7 folder routes serve their own document on direct navigation
  and on refresh (`/`, `/pricing/`, `/login/`, `/register/`, `/forgot-password/`,
  `/reset-password/`, `/account/`); unauthenticated `/account/` resolves to the
  sign-in document.
- **Responsive** — 7 routes × 6 viewports = **42/42 with zero horizontal
  overflow**: 1440×900, 1280×800 (desktop), 1024×1366, 1180×820 (tablet),
  390×844, 430×932 (mobile portrait). Desktop is a real horizontal split;
  mobile is a real vertical stack.
- **Console** — **0 errors, 0 warnings, 0 failed requests** across all 7 routes.
- **Pricing** — rendered figures match the approved plan table exactly: Free Beta
  5 hr/month, 2 hr/day, 1 hr recording, 1 hr live, 2 recordings/day,
  2 jobs/day; Student Basic $4.99/month, 10 hr/month, 2 hr/day, 1.5 hr recording,
  1.5 hr live, 6 recordings/day, 10 jobs/day.
- **Content sweep** — no `service_role`/`sk_live`/`sk_test`/`whsec_`/private-key/
  `client_secret`/Brevo strings in `landing/`; the public anon key appears only in
  `app/config.js`; no `console.log/info/debug` in `landing/app/`; no `unlimited`,
  no `6-digit`, no `v0.1.8`, and no `localhost` references remain.
- **Suite** — `vitest run`: 433 passed, 1 failed; typecheck clean; build clean;
  `eslint` reports 8 errors in pre-existing Desktop `src/` files and **0 in
  `landing/`**. The single test failure is the documented pre-existing
  `server/phase4CrossRepoContract.test.mjs` iPad contract case, untouched here.

### Changes made in this pass

- `landing/app/auth-shell.css` — added `.yl-auth-full`: full-viewport
  (`100dvh`) edge-to-edge auth split, no radius/border/shadow, and a
  `grid-template-rows: auto 1fr` mobile stack. Scoped so the Desktop
  `.yl-auth-surface` and `.compact` variants are unchanged.
- `landing/app/auth-ui.js` — `surface()` drops its inline `max-width:1040px`
  centering wrapper for `.yl-auth-full`; the brand wordmark now links to `/`.
- `landing/login|register|forgot-password|reset-password/index.html` — removed
  `#site-header` and `header.js`; these pages own the entire viewport.
- `landing/app/commercial.css`, `landing/styles.css` — `.nav-login` gained
  `display:inline-flex; align-items:center; line-height:1`. It previously
  inherited `display:block` under a `min-height:40px`, so the "Log in" label
  rendered against the top of its box and sat visibly higher than the rest of
  the nav.
- `landing/index.html` — replaced three claims that contradicted the launched
  paid plan: the trust section now reads "Youmi Lens is free to start — no card
  required." and "Student Basic is optional; the Free Beta plan stays free.";
  the footer reads "Free Beta · Student Basic from $4.99/mo".

### Still blocked — requires the account holder to drive credential entry

These steps need a human to create an account, type a password, or complete an
identity provider's consent screen. They are outside what an agent should do on
the owner's behalf, so they remain unverified:

- **Google OAuth (real round trip)** — configuration is audited and correct, but
  completing Google sign-in requires the account holder. Redirects are already
  allow-listed for `http://localhost:8080/account/`.
- **Email registration (real 8-digit signup code)** — creating the account and
  choosing its password must be done by the account holder.
- **Apple OAuth** — blocked earlier and independently: the Supabase Apple
  provider holds only the native client ID `com.aydenz.youmilensipad` with an
  empty client secret. A Website Services ID, verified `youmilens.com` domain and
  return URL, and a generated client secret are prerequisites.
- **Stripe checkout/portal round trip** — Railway production defines no Stripe
  configuration, so the backend correctly returns an unavailable state. Adding
  it triggers a redeploy and needs explicit approval.

## Deployment gate

Do not commit, push, merge, or deploy from this runbook. First present the final
scope diff and verification report. After explicit product-owner approval:

1. stage only the production Website files, this runbook, and the exact Website
   production test;
2. review the staged diff line by line;
3. commit with `feat(web): add shared account, pricing, and auth flows`;
4. push only the approved branch;
5. merge/deploy only under separate explicit authorization;
6. verify Cloudflare deployment and all production routes after rollout.
