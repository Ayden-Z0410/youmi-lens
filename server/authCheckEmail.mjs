import { createClient } from '@supabase/supabase-js'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

let adminClient = null

function getAdminClient() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return null
  if (!adminClient) {
    adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return adminClient
}

async function authUserExistsByEmail(supabase, normalizedEmail) {
  const perPage = 1000
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    if (data.users.some((user) => user.email?.trim().toLowerCase() === normalizedEmail)) {
      return true
    }
    if (data.users.length < perPage) return false
  }
  throw new Error('auth_user_scan_limit_exceeded')
}

export async function handleAuthCheckEmail(req, res) {
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email : ''
  const email = rawEmail.trim().toLowerCase()

  if (!email || !EMAIL_PATTERN.test(email)) {
    res.status(400).json({ error: 'invalid_email', message: 'A valid email is required.' })
    return
  }

  const supabase = getAdminClient()
  if (!supabase) {
    console.error('[auth-check-email] Supabase service-role client not configured')
    res.status(503).json({ error: 'auth_check_unavailable' })
    return
  }

  try {
    const exists = await authUserExistsByEmail(supabase, email)
    res.json({ exists })
  } catch (err) {
    console.error('[auth-check-email]', err)
    res.status(500).json({ error: 'auth_check_failed' })
  }
}
