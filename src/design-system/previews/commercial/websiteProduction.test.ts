/**
 * Phase 4A — production Website (landing/) guardrails.
 * Verifies exact commercial values, navigation additions, real (non-mock) auth
 * wiring, and that NO secret is exposed in the static site.
 */
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
// plans.js is plain ESM — vitest transforms + imports it directly.
import { FREE, PAID, PRICE, COMPARE_ROWS, usd, annualPerMonth } from '../../../../landing/app/plans.js'

const L = (p: string) => readFileSync(new URL(`../../../../landing/${p}`, import.meta.url), 'utf8')

describe('exact approved prices / quotas (landing/app/plans.js)', () => {
  it('Free Beta + Student Basic values are exact', () => {
    expect(FREE).toMatchObject({ monthlyMinutes: 300, dailyMinutes: 120, maxRecordingMinutes: 60, maxLiveSessionMinutes: 60, recordingsPerDay: 2, processingJobsPerDay: 2 })
    expect(PAID).toMatchObject({ monthlyMinutes: 600, dailyMinutes: 120, maxRecordingMinutes: 90, maxLiveSessionMinutes: 90, recordingsPerDay: 6, processingJobsPerDay: 10, entitlementDays: 30 })
  })
  it('prices are $4.99/mo, $49.99/yr, ≈$4.17/mo annual', () => {
    expect(usd(PRICE.monthly.usdCents)).toBe('$4.99')
    expect(usd(PRICE.annual.usdCents)).toBe('$49.99')
    expect(annualPerMonth()).toBe('$4.17')
    expect(PRICE.monthly.code).toBe('student_basic_monthly')
    expect(PRICE.annual.code).toBe('student_basic_annual')
  })
  it('comparison rows use the real numbers', () => {
    const by = Object.fromEntries(COMPARE_ROWS.map((r: string[]) => [r[0], r]))
    expect(by['Transcription minutes / month']).toEqual(['Transcription minutes / month', '5 hr', '10 hr'])
    expect(by['Recordings / day']).toEqual(['Recordings / day', '2', '6'])
    expect(by['Processing jobs / day']).toEqual(['Processing jobs / day', '2', '10'])
  })
})

describe('homepage navigation additions (only Pricing + Log in/Account)', () => {
  const html = L('index.html')
  const css = L('styles.css')
  it('preserves all existing nav items', () => {
    for (const item of ['#features', '#privacy', '#download', '#support']) expect(html).toContain(item)
    expect(html).toMatch(/Features/); expect(html).toMatch(/Support/)
  })
  it('adds a Pricing link and a Log in/Account entry — and nothing else conceptually', () => {
    expect(html).toContain('href="/pricing/"')
    expect(html).toContain('id="home-auth-entry"')
    expect(html).toContain('nav-login')
    expect(html).toContain('data-account-href="/account/"')
  })
  it('uses the current production v0.1.9 download links (stale v0.1.8 removed)', () => {
    // Phase 4A-1 Correction 4: worktree base had v0.1.8; production (main) + gh Latest = v0.1.9.
    expect(html).toContain('releases/download/v0.1.9/Youmi.Lens_0.1.9_aarch64.dmg')
    expect(html).not.toMatch(/0\.1\.8/)
    expect(html).toContain('Version 0.1.9')
    expect(html).toContain('Download for macOS')
  })
  it('supports both portrait mobile and horizontal phone/tablet layouts', () => {
    expect(css).toMatch(/@media \(min-width: 769px\) and \(max-width: 1024px\)/)
    expect(css).toMatch(/grid-template-columns:\s*auto minmax\(0, 1fr\) auto/)
    expect(css).toMatch(/grid-template-columns:\s*minmax\(190px, 24%\) minmax\(0, 1fr\)/)
    expect(css).toMatch(/@media \(min-width: 769px\) and \(max-width: 900px\)/)
    expect(css).toMatch(/@media \(max-width: 768px\)/)
    expect(css).toMatch(/\.hero-actions\s*\{\s*flex-direction:\s*column/)
  })
})

describe('Phase 4A-1 — shared auth logic (code lengths + reset flow + homepage session)', () => {
  const reg = L('app/register.js')
  const forgot = L('app/forgot.js')
  const auth = L('app/auth.js')
  const homeNav = L('app/home-nav.js')

  it('signup verification is the real 8-digit backend code', () => {
    expect(reg).toContain('maxlength="8"')
    expect(reg).toMatch(/pattern="\[0-9\]\{8\}"/)
    expect(reg).toMatch(/\/\^\\d\{8\}\$\//) // client validates exactly 8 digits
    expect(reg).toMatch(/8-digit/)
    expect(reg).not.toMatch(/6-digit/)
  })

  it('forgot-password uses the SHARED code flow (verifyOtp recovery), not a website-only link', () => {
    // same mechanism as iPad/Desktop: resetPasswordForEmail → verifyOtp(recovery) → updateUser
    expect(auth).toMatch(/resetPasswordForEmail\(email\.trim\(\)\)/) // no redirectTo → emails the OTP
    expect(auth).toMatch(/verifyOtp\(\{[^}]*type:\s*'recovery'/)
    expect(auth).toContain('sendPasswordResetCode')
    expect(auth).toContain('verifyPasswordResetCode')
    // forgot.js walks email → code → new password
    for (const s of ['sendPasswordResetCode', 'verifyPasswordResetCode', 'updatePassword']) expect(forgot).toContain(s)
    // no website-only reset link/redirect remains
    expect(auth).not.toMatch(/resetReturnPath.*redirectTo|redirectTo:\s*absReturn\(CFG\.resetReturnPath/)
  })

  it('homepage session uses the shared auth client (getSession + onAuthChange), not localStorage parsing', () => {
    expect(homeNav).toMatch(/import\s*\{[^}]*getSession[^}]*onAuthChange[^}]*\}\s*from\s*'\.\/auth\.js'/)
    expect(homeNav).toContain('getSession')
    expect(homeNav).toContain('onAuthChange')
    // must NOT hand-parse Supabase token storage (check code, not the doc comment)
    const homeCode = homeNav.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(homeCode).not.toMatch(/localStorage/)
    expect(homeCode).not.toMatch(/sb-.*auth-token/)
    // valid session → Account; else Log in
    expect(homeNav).toMatch(/if \(session\)/)
    expect(homeNav).toContain("'Log in'")
  })

  it('shares one in-flight Supabase client load across concurrent header/page callers', () => {
    expect(auth).toMatch(/let _clientPromise = null/)
    expect(auth).toMatch(/if \(!_clientPromise\)\s*\{\s*_clientPromise = \(async \(\) => \{/)
    expect(auth).toMatch(/_client = await _clientPromise/)
    expect(auth).not.toMatch(/_loadTried/)
  })

  it('settles persisted-session hydration before redirecting a signed-in user to login', () => {
    expect(auth).toMatch(/setTimeout\(resolve, 120\)/)
    expect(auth.match(/c\.auth\.getSession\(\)/g)?.length).toBeGreaterThanOrEqual(2)
    expect(L('app/login.js')).toMatch(/onAuthChange\(\(session\) => \{ if \(session\) location\.replace\(next\)/)
    expect(L('app/register.js')).toMatch(/onAuthChange\(\(session\) => \{ if \(session\) location\.replace\('\/account\/'\)/)
  })

  it('homepage loads config so the shared client can resolve a session', () => {
    expect(L('index.html')).toContain('/app/config.js')
    expect(L('index.html')).toMatch(/type="module"[^>]*home-nav\.js/)
  })
})

describe('Phase 4B-P — Pricing behavior + billing contract', () => {
  const pricing = L('app/pricing.js')
  const account = L('app/account.js')
  const auth = L('app/auth.js')

  it('Pricing and Account share the single plan-value source (plans.js) — no drifting duplication', () => {
    expect(pricing).toMatch(/from '\.\/plans\.js'/)
    expect(account).toMatch(/from '\.\/plans\.js'/)
    // both derive price/mins from plans.js rather than hardcoding
    expect(pricing).toMatch(/PRICE|usd|mins/)
    expect(account).toMatch(/PRICE|usd|mins/)
  })

  it('visitor Upgrade routes to auth first (no checkout without a session)', () => {
    expect(pricing).toMatch(/if \(!signedIn\)\s*\{[^}]*location\.assign\('\/register\/'\)/)
  })

  it('signed-in Upgrade sends the correct plan_code and locks the button while loading', () => {
    expect(pricing).toMatch(/PRICE\.annual\.code\s*:\s*PRICE\.monthly\.code/)
    expect(pricing).toMatch(/b\.disabled = true/) // duplicate-click lock
    expect(pricing).toMatch(/startCheckout\(code\)/)
  })

  it('current plan is marked and its action disabled (no upgrade-to-same-plan)', () => {
    expect(pricing).toMatch(/Current plan/)
    expect(pricing).toMatch(/Your current plan.*disabled|disabled.*Your current plan/s)
    expect(pricing).toMatch(/isPaidCurrent/)
  })

  it('checkout/portal are authenticated (Bearer) and redirect only to the returned Stripe URL', () => {
    expect(auth).toMatch(/startCheckout\(planCode\)\s*\{\s*return authedPost\('\/billing\/checkout', \{ plan_code: planCode \}\)/)
    expect(auth).toMatch(/openBillingPortal\(\)\s*\{\s*return authedPost\('\/billing\/portal'/)
    expect(auth).toMatch(/if \(!token\) return \{ ok: false, code: 'auth_required'/)
    expect(auth).toMatch(/Authorization: `Bearer \$\{token\}`/)
    // only the server-provided url is used for redirect
    expect(auth).toMatch(/body\.ok && safeUrl/)
    expect(auth).toContain("'checkout.stripe.com', 'billing.stripe.com'")
    expect(auth).toMatch(/url\.protocol === 'https:'/)
    expect(pricing).toMatch(/if \(r\.ok\) \{ location\.assign\(r\.url\)/)
    expect(account).toMatch(/if \(r\.ok\) \{ location\.assign\(r\.url\)/)
  })

  it('no unsupported "unlimited" wording and no old price on Pricing', () => {
    expect(pricing).not.toMatch(/unlimited/i)
    expect(pricing).not.toMatch(/\$4\.9[0-8]|\$5\.99|\$3\.99|\$9\.99/) // no wrong prices
  })
})

describe('production auth wiring is REAL (no mocks) and uses the shared endpoints', () => {
  const auth = L('app/auth.js')
  it('uses the shared shared-account endpoints and Supabase', () => {
    expect(auth).toContain('/auth/check-email')
    expect(auth).toContain('/auth/send-signup-code')
    expect(auth).toContain('/auth/verify-signup-code-and-create-user')
    expect(auth).toContain('/subscription/status')
    expect(auth).toMatch(/signInWithOAuth/)
    expect(auth).toMatch(/resetPasswordForEmail/)
  })
  it('has no mock user / fake token / hardcoded credentials', () => {
    // strip comments + strings so prose like "no mocks" doesn't trip the scan
    const code = auth
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      .replace(/`(?:\\.|[^`\\])*`/g, '``').replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/"(?:\\.|[^"\\])*"/g, '""')
    expect(code).not.toMatch(/\bmockUser\b|\bfakeToken\b|\bfake_token\b|\bdummyUser\b/i)
    expect(auth).not.toMatch(/password\s*[:=]\s*['"][^'"]{3,}['"]/) // no literal password value
  })
  it('registration flow order: check-email → send-code → verify-create', () => {
    const reg = L('app/register.js')
    expect(reg.indexOf('checkEmail')).toBeGreaterThan(0)
    expect(reg.indexOf('checkEmail')).toBeLessThan(reg.indexOf('sendSignupCode'))
    expect(reg.indexOf('sendSignupCode')).toBeLessThan(reg.indexOf('verifySignupCodeAndCreateUser'))
  })
})

describe('security — no secrets in the static site', () => {
  const files = ['app/config.js', 'app/auth.js', 'app/account.js', 'app/pricing.js', 'app/register.js', 'app/login.js', 'app/forgot.js', 'app/reset.js', 'app/header.js', 'app/home-nav.js', 'app/plans.js']
  it('no service-role / secret / stripe-secret keys anywhere', () => {
    for (const f of files) {
      const s = L(f)
      expect(s, f).not.toMatch(/service_role|SERVICE_ROLE/)
      expect(s, f).not.toMatch(/sk_live_|sk_test_|rk_live_/) // stripe secret/restricted keys
      expect(s, f).not.toMatch(/BREVO|SUPABASE_SERVICE|STRIPE_SECRET|WEBHOOK_SECRET/)
    }
  })
  it('config is populated with PUBLIC production values only (Phase 4B) — no placeholders, no service-role', () => {
    const cfg = L('app/config.js')
    expect(cfg).not.toContain('__FILL_') // no placeholders remain
    expect(cfg).toMatch(/supabaseUrl:\s*"https:\/\/[a-z0-9]+\.supabase\.co"/)
    expect(cfg).toMatch(/apiBaseOrigin:\s*"https:\/\//)
    expect(cfg).not.toMatch(/localhost|127\.0\.0\.1/)
    // the embedded key is the PUBLIC anon key (role:anon), never the service-role key
    const m = cfg.match(/supabaseAnonKey:\s*"(eyJ[A-Za-z0-9_.-]+)"/)
    expect(m, 'anon key present').toBeTruthy()
    const payload = JSON.parse(Buffer.from(m![1].split('.')[1], 'base64').toString('utf8'))
    expect(payload.role).toBe('anon')
    expect(cfg).not.toMatch(/service_role/)
  })
  it('never logs passwords / codes / tokens', () => {
    for (const f of files) {
      const s = L(f)
      expect(s, f).not.toMatch(/console\.(log|info|warn|error)\([^)]*\b(password|code|token|access_token)\b/i)
    }
  })
  it('redirect targets are validated to same-site paths', () => {
    expect(L('app/auth.js')).toMatch(/function safePath/)
    expect(L('app/auth.js')).toMatch(/startsWith\('\/'\)/)
  })
  it('authenticated Account API reads opt out of browser caching', () => {
    expect(L('app/auth.js')).toMatch(/cache:\s*'no-store'/)
  })
  it('recovery-code UI never advertises a reset link as the primary flow', () => {
    expect(L('app/forgot.js')).not.toMatch(/reset link|send.*link/i)
    expect(L('app/reset.js')).not.toMatch(/reset link|request a new link/i)
  })
})
