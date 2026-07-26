/**
 * Website Forgot Password — SHARED code flow (identical to iPad + Desktop):
 *   email → send reset code → enter code (Supabase recovery OTP) → new password
 *   → updateUser → sign in. Uses Supabase resetPasswordForEmail + verifyOtp
 *   ({type:'recovery'}) + updateUser — the same shared production mechanism.
 *   No Website-only reset logic; no redirect link required.
 */
import { sendPasswordResetCode, verifyPasswordResetCode, updatePassword, signOut, isConfigured } from './auth.js'
import { surface, mount, banner, esc, EMAIL_RE } from './auth-ui.js'

let step = 'email' // 'email' | 'code' | 'password' | 'done'
let email = ''
let showPw = false
let msg = null

function emailBody() {
  return `
    <h1 class="yl-auth-title">Reset password</h1>
    <p class="yl-auth-lede">Enter your account email and we’ll send a reset code.</p>
    ${!isConfigured() ? banner('info', 'Preview: the account service isn’t configured in this environment.') : ''}
    ${msg ? banner('err', esc(msg)) : ''}
    <form id="f"><div class="yl-auth-field"><label for="email">Email</label>
      <input id="email" class="yl-auth-input" type="email" autocomplete="email" placeholder="you@university.edu" value="${esc(email)}" required>
      <p class="yl-auth-err" id="err" hidden></p></div>
      <button type="submit" class="yl-auth-primary" id="submit">Send reset code</button></form>
    <a class="yl-auth-back" href="/login/">Back to sign in</a>`
}
function codeBody() {
  return `
    <div class="yl-auth-center"><div class="yl-auth-icon">✉️</div><h1 class="yl-auth-title">Enter your code</h1>
      <p class="yl-auth-lede">We emailed a reset code to <strong>${esc(email)}</strong>. Enter it to continue.</p></div>
    ${msg ? banner('err', esc(msg)) : ''}
    <form id="cf"><div class="yl-auth-field"><label for="code">Reset code</label>
      <input id="code" class="yl-auth-input yl-auth-code" inputmode="numeric" maxlength="8" pattern="[0-9]{8}" placeholder="••••••••" required></div>
      <button type="submit" class="yl-auth-primary" id="csubmit">Verify code</button></form>
    <button type="button" class="yl-auth-back" id="resend">Resend code</button>
    <button type="button" class="yl-auth-back" id="change">Change email</button>`
}
function passwordBody() {
  return `
    <h1 class="yl-auth-title">Set a new password</h1>
    <p class="yl-auth-lede">Choose a new password for your Youmi Lens account.</p>
    ${msg ? banner('err', esc(msg)) : ''}
    <form id="pf"><div class="yl-auth-field"><label for="pw">New password</label>
      <div class="yl-auth-pw"><input id="pw" class="yl-auth-input" type="${showPw ? 'text' : 'password'}" autocomplete="new-password" placeholder="New password" required>
        <button type="button" class="yl-auth-eye" id="eye">${showPw ? 'Hide' : 'Show'}</button></div></div>
      <div class="yl-auth-field"><label for="cf2">Confirm password</label>
        <input id="cf2" class="yl-auth-input" type="${showPw ? 'text' : 'password'}" autocomplete="new-password" placeholder="Re-enter new password" required>
        <p class="yl-auth-err" id="perr" hidden></p></div>
      <button type="submit" class="yl-auth-primary" id="psubmit">Update password</button></form>`
}
function doneBody() {
  return `<div class="yl-auth-center"><div class="yl-auth-icon ok">✓</div><h1 class="yl-auth-title">Password updated</h1>
    <p class="yl-auth-lede">Your password has been changed. Sign in with your new password.</p>
    <a class="yl-auth-primary" style="display:block;text-align:center;text-decoration:none;line-height:52px" href="/login/">Go to sign in</a></div>`
}

function paint() {
  mount(surface(step === 'email' ? emailBody() : step === 'code' ? codeBody() : step === 'password' ? passwordBody() : doneBody()))
  if (step === 'email') {
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault()
      email = document.getElementById('email').value.trim()
      const err = document.getElementById('err')
      if (!EMAIL_RE.test(email)) { err.hidden = false; err.textContent = 'Enter a valid email address.'; return }
      const btn = document.getElementById('submit'); btn.disabled = true; btn.textContent = 'Sending…'
      const r = await sendPasswordResetCode(email)
      if (r.ok) { step = 'code'; msg = null; return paint() }
      msg = r.message; paint()
    })
  } else if (step === 'code') {
    document.getElementById('cf').addEventListener('submit', async (e) => {
      e.preventDefault()
      const code = document.getElementById('code').value
      const btn = document.getElementById('csubmit'); btn.disabled = true; btn.textContent = 'Verifying…'
      const r = await verifyPasswordResetCode(email, code)
      if (r.ok) { step = 'password'; msg = null; return paint() }
      msg = r.message; paint()
    })
    document.getElementById('resend').addEventListener('click', async () => { const r = await sendPasswordResetCode(email); msg = r.ok ? null : r.message; paint() })
    document.getElementById('change').addEventListener('click', () => { step = 'email'; msg = null; paint() })
  } else if (step === 'password') {
    document.getElementById('eye').addEventListener('click', () => { showPw = !showPw; paint() })
    document.getElementById('pf').addEventListener('submit', async (e) => {
      e.preventDefault()
      const pw = document.getElementById('pw').value
      const cf = document.getElementById('cf2').value
      const perr = document.getElementById('perr')
      if (pw.length < 8) { perr.hidden = false; perr.textContent = 'Password must be at least 8 characters.'; return }
      if (pw !== cf) { perr.hidden = false; perr.textContent = 'Passwords don’t match.'; return }
      const btn = document.getElementById('psubmit'); btn.disabled = true; btn.textContent = 'Updating…'
      const r = await updatePassword(pw)
      if (r.ok) { await signOut(); step = 'done'; msg = null; return paint() }
      msg = r.message; paint()
    })
  }
}
paint()
