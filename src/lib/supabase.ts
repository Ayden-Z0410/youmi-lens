import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isTauri } from '@tauri-apps/api/core'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

let client: SupabaseClient | null = null

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anon && url.length > 0 && anon.length > 0)
}

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null
  if (!client) {
    const desktop = typeof window !== 'undefined' && isTauri()
    client = createClient(url!, anon!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        /** Deep-link auth uses `lecturecompanion://…`, not `window.location`; avoid init-time URL parsing fighting manual handlers. */
        detectSessionInUrl: !desktop,
      },
    })
  }
  return client
}
