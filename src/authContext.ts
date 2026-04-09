import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'

export type AuthContextValue = {
  configured: boolean
  loading: boolean
  session: Session | null
  user: User | null
  signInWithGoogle: () => Promise<void>
  signInWithApple: () => Promise<void>
  /** Magic link; enable Email provider in Supabase Auth settings. */
  signInWithEmailOtp: (email: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
