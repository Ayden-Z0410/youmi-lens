/** Website Login — real Supabase email/password + Apple/Google OAuth. */
import { getSession, onAuthChange, signInWithPassword, signInWithProvider, isConfigured, safePath } from './auth.js'
import { surface, ssoStack, mount, banner, esc, EMAIL_RE } from './auth-ui.js'

const params = new URLSearchParams(location.search)
const next = safePath(params.get('next') || '/account/')
let showPw = false
let msg = null

function body() {
  return `
    <h1 class="yl-auth-title">Welcome back</h1>
    <div class="yl-auth-switch"><span>New to Youmi Lens?</span><a href="/register/">Create account</a></div>
    ${!isConfigured() ? banner('info', 'Preview: the account service isn’t configured in this environment. The UI is fully interactive; sign-in completes once production config is set.') : ''}
    ${msg ? banner('err', esc(msg)) : ''}
    ${ssoStack('sign in')}
    <form id="f">
      <div class="yl-auth-field"><label for="email">Email</label>
        <input id="email" class="yl-auth-input" type="email" autocomplete="email" placeholder="you@university.edu" required></div>
      <div class="yl-auth-field">
        <div class="yl-auth-forgot"><a href="/forgot-password/">Forgot password?</a></div>
        <label for="pw">Password</label>
        <div class="yl-auth-pw"><input id="pw" class="yl-auth-input" type="${showPw ? 'text' : 'password'}" autocomplete="current-password" placeholder="••••••••" required>
          <button type="button" class="yl-auth-eye" id="eye">${showPw ? 'Hide' : 'Show'}</button></div>
        <p class="yl-auth-err" id="err" hidden></p>
      </div>
      <button type="submit" class="yl-auth-primary" id="submit">Sign in</button>
    </form>`
}

function paint() {
  mount(surface(body()))
  document.querySelectorAll('[data-provider]').forEach((b) =>
    b.addEventListener('click', async () => { const r = await signInWithProvider(b.dataset.provider); if (!r.ok) { msg = r.message; paint() } }))
  document.getElementById('eye').addEventListener('click', () => { showPw = !showPw; paint() })
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault()
    const email = document.getElementById('email').value.trim()
    const pw = document.getElementById('pw').value
    const err = document.getElementById('err')
    if (!EMAIL_RE.test(email)) { err.hidden = false; err.textContent = 'Enter a valid email address.'; return }
    if (pw.length < 8) { err.hidden = false; err.textContent = 'Password must be at least 8 characters.'; return }
    const btn = document.getElementById('submit'); btn.disabled = true; btn.textContent = 'Signing in…'
    const r = await signInWithPassword(email, pw)
    if (r.ok) { location.assign(next); return }
    msg = r.message; paint()
  })
}

;(async () => {
  if (await getSession()) { location.replace(next); return } // already signed in
  paint()
  // Covers the narrow persisted-session hydration window and OAuth completion
  // without relying on a second manual refresh.
  onAuthChange((session) => { if (session) location.replace(next) })
})()
