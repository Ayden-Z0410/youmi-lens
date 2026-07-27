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

/**
 * Phase 4C — one toolbar, one destination map.
 *
 * The Pricing/Account toolbar used to be a hand-copied duplicate inside
 * app/commercial.css. It preserved only the FIRST of the seventeen cascading
 * .site-nav blocks in styles.css, so those routes rendered a square 1220px bar
 * with a 55px logo while the homepage rendered the approved 1120px floating
 * glass bar with a 94px logo. These guard that regression class.
 */
describe('Phase 4C — shared toolbar + navigation destinations', () => {
  const ROUTES = ['pricing/index.html', 'account/index.html']

  it('commercial.css declares no toolbar rules — styles.css owns the toolbar', () => {
    const css = L('app/commercial.css')
    for (const sel of ['.site-nav', '.nav-links', '.nav-download', '.brand-wordmark', '.nav-login', '.nav-account']) {
      expect(css, `commercial.css must not redefine ${sel}`).not.toMatch(
        new RegExp(`^\\${sel}[\\s,{]`, 'm'),
      )
    }
  })

  it('every route that renders the toolbar loads the one stylesheet that defines it', () => {
    for (const r of ROUTES) {
      expect(L(r), r).toMatch(/<link rel="stylesheet" href="\/styles\.css/)
    }
  })

  it('homepage toolbar links are absolute so they resolve from any route', () => {
    const nav = L('index.html').match(/<nav class="nav-links"[\s\S]*?<\/nav>/)?.[0] ?? ''
    expect(nav).toBeTruthy()
    for (const href of ['/#features', '/#privacy', '/#download', '/pricing/', '/#support']) {
      expect(nav, `homepage nav must link ${href}`).toContain(`href="${href}"`)
    }
    // A bare "#download" here would resolve to /pricing/#download once the shared
    // helper reuses this map, so route-relative section links are forbidden.
    expect(nav).not.toMatch(/href="#/)
  })

  it('shared header helper uses the same absolute destinations as the homepage', () => {
    const hdr = L('app/header.js')
    for (const href of ['/#features', '/#privacy', '/#download', '/pricing/', '/#support']) {
      expect(hdr, `header.js must link ${href}`).toContain(`'${href}'`)
    }
    expect(hdr).toMatch(/href="\/"/)          // logo → /
    expect(hdr).toContain('/login/')
    expect(hdr).toContain('/account/')
  })

  it('the macOS CTA is the same real v0.1.9 build everywhere (never /#download)', () => {
    const dmg = 'releases/download/v0.1.9/Youmi.Lens_0.1.9_aarch64.dmg'
    expect(L('app/header.js')).toContain(dmg)
    const homeCta = L('index.html').match(/<a class="nav-download"[^>]*>/)?.[0] ?? ''
    expect(homeCta).toContain(dmg)
    expect(L('app/header.js')).not.toMatch(/nav-download" href="\/#download"/)
  })

  it('Pricing is the only item that can go active, and only on /pricing/', () => {
    const hdr = L('app/header.js')
    expect(hdr).toMatch(/location\.pathname\.startsWith\('\/pricing'\)/)
    expect(hdr).toMatch(/href === '\/pricing\/' && onPricing/)
    // the static homepage ships no active state, so Pricing can never highlight there
    expect(L('index.html')).not.toMatch(/class="is-current"/)
  })

  it('anchor targets clear the fixed toolbar and respect reduced motion', () => {
    const css = L('styles.css')
    expect(css).toMatch(/scroll-padding-top:\s*92px/)
    expect(css).toMatch(/scroll-behavior:\s*smooth/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]{0,120}scroll-behavior:\s*auto/)
  })
})

describe('Phase 4C — auth brand panel hierarchy', () => {
  it('the logo scales responsively and is never distorted', () => {
    const css = L('app/auth-shell.css')
    const rule = css.match(/\.yl-auth-logo\s*\{[\s\S]*?\}/)?.[0] ?? ''
    expect(rule).toBeTruthy()
    expect(rule, 'logo must scale with the viewport, not a fixed iPad-ish size').toMatch(/height:\s*clamp\(/)
    expect(rule, 'width:auto preserves the artwork ratio').toMatch(/width:\s*auto/)
    expect(rule, 'never size both axes').not.toMatch(/width:\s*\d/)
    expect(rule).not.toMatch(/height:\s*26px/) // the old fixed size
  })

  it('"One account, every device." is the last thing in the brand column', () => {
    const panel = L('app/auth-ui.js').match(/export function brandPanel\(\)[\s\S]*?\n\}/)?.[0] ?? ''
    expect(panel).toBeTruthy()
    expect(panel).toContain('One account, every device.')
    const foot = panel.indexOf('yl-auth-brandfoot')
    const mid = panel.indexOf('yl-auth-brandmid')
    const top = panel.indexOf('yl-auth-brandtop')
    expect(top).toBeGreaterThan(-1)
    expect(mid).toBeGreaterThan(top)
    expect(foot, 'the tagline block must come after the message block').toBeGreaterThan(mid)
    // and it must be the final element of the panel
    expect(panel.lastIndexOf('yl-auth-brandfoot')).toBeGreaterThan(panel.lastIndexOf('yl-auth-wave'))
    expect(L('app/auth-shell.css')).toMatch(/\.yl-auth-brandfoot\s*\{[^}]*margin-top:\s*auto/)
  })

  it('the Apple button is still offered on the Website (config is the blocker, not the UI)', () => {
    expect(L('app/auth-ui.js')).toMatch(/data-provider="apple"/)
    expect(L('app/auth-ui.js')).toMatch(/Continue with Apple/)
  })
})

/**
 * Phase 6 — static routing.
 *
 * Cloudflare Pages resolves an unmatched path in this order: _redirects → 404.html
 * → serve /index.html with HTTP 200. landing/ shipped none of the first two, so
 * every unknown path (and every not-yet-deployed asset) returned the homepage
 * with a 200 — /app/config.js came back as text/html, which breaks module loading
 * silently instead of failing loudly. A committed 404.html restores real 404s.
 */
describe('Phase 6 — static 404 routing (no SPA catch-all)', () => {
  it('ships a 404 page so unmatched paths cannot fall through to index.html', () => {
    const nf = L('404.html')
    expect(nf).toMatch(/<!DOCTYPE html>/i)
    expect(nf).toMatch(/404/)
    expect(nf).toMatch(/href="\/"/)            // a way back home
  })

  it('the 404 page reuses the approved design system, not a second one', () => {
    const nf = L('404.html')
    expect(nf).toMatch(/href="\/styles\.css/)
    expect(nf).toMatch(/class="button button-primary"/)
  })

  it('the 404 page leaks no debug information', () => {
    const nf = L('404.html')
    expect(nf).not.toMatch(/stack|trace|exception|localhost|127\.0\.0\.1|TODO/i)
    expect(nf).not.toMatch(/console\.(log|debug|info|error)/)
  })

  it('no _redirects / _routes.json rewrites every path to index.html', () => {
    // Their absence is the point: a catch-all would recreate the 200-for-everything
    // bug that made a missing route indistinguishable from a working one.
    for (const f of ['_redirects', '_routes.json']) {
      let body: string | null = null
      try { body = L(f) } catch { body = null }
      if (body !== null) {
        expect(body, `${f} must not contain a catch-all rewrite`).not.toMatch(/^\s*\/\*\s+\/index\.html\s+200/m)
        expect(body, `${f} must not declare an SPA fallback`).not.toMatch(/"include"\s*:\s*\[\s*"\/\*"\s*\]/)
      }
    }
  })

  it('real folder routes still exist as their own documents', () => {
    for (const r of ['pricing', 'login', 'register', 'forgot-password', 'reset-password', 'account']) {
      expect(L(`${r}/index.html`), `${r} must be a real document`).toMatch(/<!doctype html>/i)
    }
  })
})

/**
 * Shared "Resend code" / "Change email" controls (auth-ui.js), used by BOTH the
 * registration verify step and the password-reset code step.
 *
 * Both screens previously rendered bare .yl-auth-back text buttons with no
 * hover/focus/active/disabled styling, and a handler that awaited the network
 * before repainting — so a click produced no visible change and duplicate
 * requests were possible. One controller now serves both screens.
 */
describe('Shared auth resend + change-email feedback', () => {
  const ui = () => L('app/auth-ui.js')
  const shell = () => L('app/auth-shell.css')
  const SCREENS = ['app/forgot.js', 'app/register.js']

  it('there is exactly ONE implementation, owned by auth-ui.js', () => {
    expect(ui()).toMatch(/export function wireResendControls/)
    for (const f of SCREENS) {
      expect(L(f), `${f} must not re-implement the controller`).not.toMatch(/function wireResendControls/)
      expect(L(f), `${f} must not re-implement the countdown`).not.toMatch(/setInterval\(/)
    }
  })

  it('both screens use the shared markup and controller', () => {
    for (const f of SCREENS) {
      const s = L(f)
      expect(s, f).toMatch(/resendControlsHtml\(resend\)/)
      expect(s, f).toMatch(/wireResendControls\(resend, \{/)
      expect(s, f).toMatch(/createResendState\(\)/)
    }
  })

  it('resend shows an immediate loading state and disables the control', () => {
    expect(ui()).toMatch(/btn\.disabled = true/)
    expect(ui()).toMatch(/btn\.textContent = 'Sending…'/)
  })

  it('duplicate resend requests are blocked by an in-flight guard and the cooldown', () => {
    expect(ui()).toMatch(/if \(rs\.busy \|\| resendCooldownSeconds\(rs\) > 0\) return/)
    expect(ui()).toMatch(/rs\.busy = true/)
    expect(ui()).toMatch(/rs\.busy = false/)
  })

  it('success confirms and starts a visible cooldown countdown', () => {
    expect(ui()).toMatch(/setStatus\('ok', 'New code sent'\)/)
    expect(ui()).toMatch(/rs\.until = Date\.now\(\) \+ RESEND_COOLDOWN_MS/)
    expect(ui()).toMatch(/Resend in \$\{s\}s/)
    expect(ui()).toMatch(/RESEND_COOLDOWN_MS = 30_000/)
  })

  it('the cooldown survives a repaint so it cannot be bypassed', () => {
    // state lives with the caller at module scope, not inside paint()
    for (const f of SCREENS) expect(L(f), f).toMatch(/^const resend = createResendState\(\)/m)
    expect(ui()).toMatch(/if \(resendCooldownSeconds\(rs\) > 0\) runCountdown\(\)/)
  })

  it('failure restores the control and reports inline', () => {
    expect(ui()).toMatch(/btn\.disabled = false[\s\S]{0,80}btn\.textContent = 'Resend code'/)
    expect(ui()).toMatch(/setStatus\('err',/)
  })

  it('a new resend clears the stale banner instead of stacking results', () => {
    expect(ui()).toMatch(/stale[\s\S]{0,80}\.remove\(\)/)
  })

  it('change email returns to the entry step and focuses the email field', () => {
    expect(ui()).toMatch(/field\.focus\(\)/)
    expect(ui()).toMatch(/stopResendCountdown\(rs\)/)
    // each screen resets its own transient state and returns to its entry step
    expect(L('app/forgot.js')).toMatch(/onChange: \(\) => \{ step = 'email'; msg = null; paint\(\) \}/)
    expect(L('app/register.js')).toMatch(/onChange: \(\) => \{ step = 'form'; msg = null; paint\(\) \}/)
  })

  it('the status region is an accessible live region', () => {
    expect(ui()).toMatch(/role="status"/)
    expect(ui()).toMatch(/aria-live="polite"/)
    expect(ui()).toMatch(/statusEl\.textContent = text/) // never parsed as HTML
  })

  it('resend wording never reveals whether an address exists', () => {
    for (const f of [...SCREENS, 'app/auth-ui.js']) {
      expect(L(f), f).not.toMatch(/no account|not registered|unknown email|doesn.t exist/i)
    }
  })

  it('the secondary controls have real interaction states', () => {
    const css = shell()
    expect(css).toMatch(/\.yl-auth-back:hover:not\(:disabled\)/)
    expect(css).toMatch(/\.yl-auth-back:active:not\(:disabled\)/)
    expect(css).toMatch(/\.yl-auth-back:focus-visible/)
    expect(css).toMatch(/\.yl-auth-back:disabled/)
  })

  it('the status line reserves height so results do not shift the layout', () => {
    expect(shell()).toMatch(/\.yl-auth-status\s*\{[^}]*min-height:/)
  })

  it('no timer is left running when either screen repaints', () => {
    expect(ui()).toMatch(/export function stopResendCountdown/)
    for (const f of SCREENS) {
      expect(L(f), f).toMatch(/function paint\(\) \{\s*\n\s*stopResendCountdown\(resend\)/)
    }
  })
})
