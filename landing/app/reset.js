/**
 * Website Reset Password — compatibility landing route for an existing Supabase
 * recovery session. The primary Website flow is the recovery OTP form at
 * /forgot-password/; this route does not request or advertise email links.
 */
import { getSession, updatePassword, signOut, isConfigured } from './auth.js'
import { surface, mount, banner, esc } from './auth-ui.js'

let step = 'form' // 'form' | 'done' | 'invalid'
let showPw = false
let msg = null

function body() {
  if (step === 'done') {
    return `<div class="yl-auth-center"><div class="yl-auth-icon ok">✓</div><h1 class="yl-auth-title">Password updated</h1>
      <p class="yl-auth-lede">Your password has been changed. Sign in with your new password.</p>
      <a class="yl-auth-primary" style="display:block;text-align:center;text-decoration:none;line-height:52px" href="/login/">Go to sign in</a></div>`
  }
  if (step === 'invalid') {
    return `<div class="yl-auth-center"><div class="yl-auth-icon">⚠️</div><h1 class="yl-auth-title">Recovery session expired</h1>
      <p class="yl-auth-lede">Request a new recovery code to continue.</p>
      <a class="yl-auth-primary" style="display:block;text-align:center;text-decoration:none;line-height:52px" href="/forgot-password/">Request a new code</a></div>`
  }
  return `
    <h1 class="yl-auth-title">Set a new password</h1>
    <p class="yl-auth-lede">Choose a new password for your Youmi Lens account.</p>
    ${msg ? banner('err', esc(msg)) : ''}
    <form id="f"><div class="yl-auth-field"><label for="pw">New password</label>
      <div class="yl-auth-pw"><input id="pw" class="yl-auth-input" type="${showPw ? 'text' : 'password'}" autocomplete="new-password" placeholder="New password" required>
        <button type="button" class="yl-auth-eye" id="eye">${showPw ? 'Hide' : 'Show'}</button></div></div>
      <div class="yl-auth-field"><label for="cf">Confirm password</label>
        <input id="cf" class="yl-auth-input" type="${showPw ? 'text' : 'password'}" autocomplete="new-password" placeholder="Re-enter new password" required>
        <p class="yl-auth-err" id="err" hidden></p></div>
      <button type="submit" class="yl-auth-primary" id="submit">Update password</button></form>`
}

function paint() {
  mount(surface(body()))
  if (step !== 'form') return
  document.getElementById('eye').addEventListener('click', () => { showPw = !showPw; paint() })
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault()
    const pw = document.getElementById('pw').value
    const cf = document.getElementById('cf').value
    const err = document.getElementById('err')
    if (pw.length < 8) { err.hidden = false; err.textContent = 'Password must be at least 8 characters.'; return }
    if (pw !== cf) { err.hidden = false; err.textContent = 'Passwords don’t match.'; return }
    const btn = document.getElementById('submit'); btn.disabled = true; btn.textContent = 'Updating…'
    const r = await updatePassword(pw)
    if (r.ok) { await signOut(); step = 'done'; return paint() }
    msg = r.message; paint()
  })
}

;(async () => {
  // Require a recovery session. If configured but none, send the user to the
  // primary recovery-code flow.
  if (isConfigured() && !(await getSession())) step = 'invalid'
  paint()
})()
