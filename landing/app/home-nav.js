/**
 * Homepage nav auth toggle — uses the SAME shared Website auth client as every
 * commercial page (getSession + onAuthChange). No manual parsing of Supabase
 * localStorage. Valid session → Account; no/expired session → Log in; logout and
 * OAuth-return update live. If the auth SDK fails to load, getSession resolves to
 * null and the nav stays on "Log in" — the homepage never breaks.
 */
import { getSession, onAuthChange } from './auth.js'

function apply(session) {
  const el = document.getElementById('home-auth-entry')
  if (!el) return
  if (session) {
    const initial = ((session.user && session.user.email && session.user.email[0]) || 'A').toUpperCase()
    el.href = el.dataset.accountHref || '/account/'
    el.className = 'nav-account'
    el.innerHTML = '<span class="av"></span>Account'
    el.querySelector('.av').textContent = initial // textContent → no injection
  } else {
    el.href = '/login/'
    el.className = 'nav-login'
    el.textContent = 'Log in'
  }
}

;(async () => {
  try { apply(await getSession()) } catch { /* leave default "Log in" */ }
  try { onAuthChange(apply) } catch { /* live updates unavailable; static state stands */ }
})()
