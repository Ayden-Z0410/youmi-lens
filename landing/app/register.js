/**
 * Website Create Account — uses the SHARED backend signup-code flow (same as
 * iPad/Desktop): check-email → send-signup-code → enter emailed code →
 * verify-signup-code-and-create-user → signInWithPassword → /account/.
 */
import { getSession, onAuthChange, checkEmail, sendSignupCode, verifySignupCodeAndCreateUser, signInWithProvider, isConfigured } from './auth.js'
import { surface, ssoStack, mount, banner, esc, EMAIL_RE, createResendState, resendControlsHtml, wireResendControls, stopResendCountdown } from './auth-ui.js'
import { validateUsername, USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH } from './profileFields.js'

let step = 'form' // 'form' | 'verify' | 'success'

/* Same SHARED resend controller as the password-reset code step (auth-ui.js).
   Module scope so the cooldown survives a repaint and cannot be bypassed. */
const resend = createResendState()

let showPw = false
let msg = null
let email = ''
let username = '' // preserved across repaints so a rejected submit keeps the value
let agreed = false

function formBody() {
  return `
    <h1 class="yl-auth-title">Create your account</h1>
    <div class="yl-auth-switch"><span>Already have an account?</span><a href="/login/">Sign in</a></div>
    ${!isConfigured() ? banner('info', 'Preview: the account service isn’t configured in this environment. The UI is fully interactive; account creation completes once production config is set.') : ''}
    ${msg ? banner(msg.kind, msg.html) : ''}
    ${ssoStack('sign up')}
    <form id="f">
      <div class="yl-auth-field"><label for="email">Email</label>
        <input id="email" class="yl-auth-input" type="email" autocomplete="email" placeholder="you@university.edu" value="${esc(email)}" required></div>
      <div class="yl-auth-field"><label for="uname">Username</label>
        <input id="uname" class="yl-auth-input" type="text" autocomplete="nickname" placeholder="How you want to be greeted"
               value="${esc(username)}" maxlength="${USERNAME_MAX_LENGTH}" required
               aria-describedby="uname-hint" aria-invalid="false">
        <p class="yl-auth-hint" id="uname-hint">${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} characters.</p>
        <p class="yl-auth-err" id="uerr" hidden></p></div>
      <div class="yl-auth-field"><label for="pw">Password</label>
        <div class="yl-auth-pw"><input id="pw" class="yl-auth-input" type="${showPw ? 'text' : 'password'}" autocomplete="new-password" placeholder="Create a password" required>
          <button type="button" class="yl-auth-eye" id="eye">${showPw ? 'Hide' : 'Show'}</button></div>
        <p class="yl-auth-hint">We’ll email a verification code to confirm your address.</p></div>
      <div class="yl-auth-field"><label for="cf">Confirm password</label>
        <input id="cf" class="yl-auth-input" type="${showPw ? 'text' : 'password'}" autocomplete="new-password" placeholder="Re-enter password" required></div>
      <label class="yl-auth-terms"><input type="checkbox" id="agree"${agreed ? ' checked' : ''}>
        <span>I agree to the <a href="/#support">Terms</a> and <a href="/#privacy">Privacy Policy</a>.</span></label>
      <p class="yl-auth-err" id="err" hidden></p>
      <button type="submit" class="yl-auth-primary" id="submit">Create account</button>
    </form>`
}

function verifyBody() {
  return `
    <div class="yl-auth-center"><div class="yl-auth-icon">✉️</div><h1 class="yl-auth-title">Verify your email</h1>
      <p class="yl-auth-lede">We emailed an 8-digit code to <strong>${esc(email)}</strong>. Enter it to finish creating your account.</p></div>
    ${msg ? banner(msg.kind, msg.html) : ''}
    <form id="vf"><div class="yl-auth-field"><label for="code">8-digit verification code</label>
      <input id="code" class="yl-auth-input yl-auth-code" inputmode="numeric" maxlength="8" pattern="[0-9]{8}" placeholder="••••••••" required>
      <p class="yl-auth-err" id="verr" hidden></p></div>
      <button type="submit" class="yl-auth-primary" id="vsubmit">Verify &amp; create account</button></form>
    ${resendControlsHtml(resend)}`
}

function successBody() {
  return `<div class="yl-auth-center"><div class="yl-auth-icon ok">✓</div><h1 class="yl-auth-title">You’re all set</h1>
    <p class="yl-auth-lede">Your Youmi Lens account is ready. You’re on <strong>Free Beta</strong> — upgrade to Student Basic anytime.</p>
    <a class="yl-auth-primary" style="display:block;text-align:center;text-decoration:none;line-height:52px" href="/account/">Continue to Youmi Lens</a></div>`
}

function paint() {
  stopResendCountdown(resend) // old button about to detach; the verify step restarts it
  mount(surface(step === 'form' ? formBody() : step === 'verify' ? verifyBody() : successBody()))
  if (step === 'form') {
    document.querySelectorAll('[data-provider]').forEach((b) =>
      b.addEventListener('click', async () => { const r = await signInWithProvider(b.dataset.provider); if (!r.ok) { msg = { kind: 'err', html: esc(r.message) }; paint() } }))
    document.getElementById('eye').addEventListener('click', () => { showPw = !showPw; paint() })
    document.getElementById('f').addEventListener('submit', onCreate)
  } else if (step === 'verify') {
    document.getElementById('vf').addEventListener('submit', onVerify)
    wireResendControls(resend, {
      send: () => sendSignupCode(email, username),
      onChange: () => { step = 'form'; msg = null; paint() },
    })
  }
}

/** Field-level 'taken' error after a repaint (form step must already be mounted). */
function showUsernameTaken(message) {
  const el = document.getElementById('uerr')
  const box = document.getElementById('uname')
  if (!el || !box) return
  el.hidden = false
  el.textContent = message
  box.setAttribute('aria-invalid', 'true')
  box.focus()
}

async function onCreate(e) {
  e.preventDefault()
  email = document.getElementById('email').value.trim()
  const unameEl = document.getElementById('uname')
  const pw = document.getElementById('pw').value
  const cf = document.getElementById('cf').value
  agreed = document.getElementById('agree').checked
  const err = document.getElementById('err')
  const uerr = document.getElementById('uerr')
  const fail = (m) => { err.hidden = false; err.textContent = m }
  // Username errors sit beside the Username field, not in the shared footer.
  const failUsername = (m) => {
    uerr.hidden = false; uerr.textContent = m
    unameEl.setAttribute('aria-invalid', 'true'); unameEl.focus()
  }
  err.hidden = true; uerr.hidden = true; unameEl.setAttribute('aria-invalid', 'false')

  if (!EMAIL_RE.test(email)) return fail('Enter a valid email address.')
  const uname = validateUsername(unameEl.value)
  username = unameEl.value.trim() // normalized; preserved if a later step fails
  if (!uname.ok) return failUsername(uname.message)
  if (pw.length < 8) return fail('Password must be at least 8 characters.')
  if (pw !== cf) return fail('Passwords don’t match.')
  if (!agreed) return fail('Please accept the Terms and Privacy Policy.')
  window._pw = pw // held in-memory only for this flow; never logged/persisted
  const btn = document.getElementById('submit'); btn.disabled = true; btn.textContent = 'Sending code…'
  const chk = await checkEmail(email)
  if (chk.ok && chk.exists && chk.status === 'registered') {
    msg = { kind: 'info', html: `That email already has a Youmi Lens account. <a href="/login/">Sign in instead</a>.` }; return paint()
  }
  const sent = await sendSignupCode(email, uname.value)
  if (!sent.ok) {
    // Taken usernames stay on the form with the field-level error and no email sent.
    if (sent.code === 'username_taken') { msg = null; paint(); return showUsernameTaken(sent.message) }
    msg = { kind: 'err', html: esc(sent.message) }; return paint()
  }
  step = 'verify'; msg = null; paint()
}

async function onVerify(e) {
  e.preventDefault()
  const code = document.getElementById('code').value.replace(/\s/g, '')
  const verr = document.getElementById('verr')
  if (!/^\d{8}$/.test(code)) { verr.hidden = false; verr.textContent = 'Enter the full 8-digit code.'; return }
  const btn = document.getElementById('vsubmit'); btn.disabled = true; btn.textContent = 'Verifying…'
  const r = await verifySignupCodeAndCreateUser(email, window._pw || '', code, username)
  if (r.ok) { window._pw = undefined; step = 'success'; msg = null; return paint() }
  if (r.code === 'username_taken') {
    // Lost the race — no account was created. Back to the form, value kept.
    step = 'form'; msg = null; paint()
    return showUsernameTaken(r.message)
  }
  window._pw = undefined
  msg = { kind: 'err', html: esc(r.message || 'That code didn’t work. Please try again.') }; paint()
}

;(async () => {
  if (await getSession()) { location.replace('/account/'); return }
  paint()
  onAuthChange((session) => { if (session) location.replace('/account/') })
})()
