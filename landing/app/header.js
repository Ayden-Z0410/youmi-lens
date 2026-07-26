/**
 * Shared production site header. Renders the EXISTING production navigation
 * (same .site-nav structure as the homepage) and adds ONLY the approved entries:
 *   signed out → Pricing + Log in
 *   signed in  → Pricing + Account
 * Nothing else in the nav changes. Injected into <div id="site-header">.
 */
import { getSession, onAuthChange } from './auth.js'

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }

function render(signedIn, email) {
  const current = location.pathname
  const pricingCurrent = current.startsWith('/pricing') ? ' aria-current="page" class="is-current"' : ''
  const right = signedIn
    ? `<a class="nav-account" href="/account/"><span class="av">${esc((email || 'A')[0].toUpperCase())}</span>Account</a>`
    : `<a class="nav-login" href="/login/">Log in</a>`
  return `
    <header class="site-nav" aria-label="Primary navigation">
      <a class="brand" href="/" aria-label="Youmi Lens home"><img class="brand-wordmark" src="/brand/youmi-lens-wordmark-tight.png" alt="Youmi Lens"></a>
      <nav class="nav-links" aria-label="Page sections">
        <a href="/#features">Features</a>
        <a href="/#privacy">Privacy</a>
        <a href="/#download">Download</a>
        <a href="/pricing/"${pricingCurrent}>Pricing</a>
        <a href="/#support">Support</a>
      </nav>
      <div class="nav-right">
        ${right}
        <a class="nav-download" href="/#download">Download for macOS</a>
      </div>
    </header>`
}

async function mount() {
  const host = document.getElementById('site-header')
  if (!host) return
  const paint = (session) => { host.innerHTML = render(Boolean(session), session?.user?.email) }
  paint(await getSession())
  onAuthChange(paint) // update instantly on sign in / out
}

mount()
