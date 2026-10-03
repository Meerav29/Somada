import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getSupabase } from './client'

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'unconfigured' | 'error'

export interface AuthResult {
  error: string | null
  notice: string | null
}

export interface AuthContextValue {
  status: AuthStatus
  email: string | null
  getToken: () => Promise<string | null>
  signIn: (email: string, password: string) => Promise<AuthResult>
  signUp: (email: string, password: string) => Promise<AuthResult>
  signInWithGoogle: () => Promise<AuthResult>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

const NOT_CONFIGURED: AuthResult = { error: 'Sign-in is not configured.', notice: null }

export function AuthProvider({
  children,
  loadClient = getSupabase,
}: {
  children: ReactNode
  loadClient?: () => Promise<SupabaseClient | null>
}) {
  const [client, setClient] = useState<SupabaseClient | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    loadClient()
      .then(async (c) => {
        if (cancelled) return
        if (!c) {
          setStatus('unconfigured')
          return
        }
        setClient(c)
        const { data } = await c.auth.getSession()
        if (cancelled) return
        setSession(data.session)
        setStatus(data.session ? 'signedIn' : 'signedOut')
        const { data: sub } = c.auth.onAuthStateChange((_event, next) => {
          setSession(next)
          setStatus(next ? 'signedIn' : 'signedOut')
        })
        unsubscribe = () => sub.subscription.unsubscribe()
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [loadClient])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      email: session?.user.email ?? null,
      getToken: async () => {
        if (!client) return null
        const { data } = await client.auth.getSession()
        return data.session?.access_token ?? null
      },
      signIn: async (email, password) => {
        if (!client) return NOT_CONFIGURED
        const { error } = await client.auth.signInWithPassword({ email, password })
        return { error: error?.message ?? null, notice: null }
      },
      signUp: async (email, password) => {
        if (!client) return NOT_CONFIGURED
        const { data, error } = await client.auth.signUp({ email, password })
        if (error) return { error: error.message, notice: null }
        return {
          error: null,
          notice: data.session ? null : 'Check your email to confirm your account, then sign in.',
        }
      },
      signInWithGoogle: async () => {
        if (!client) return NOT_CONFIGURED
        const { error } = await client.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}` },
        })
        return { error: error?.message ?? null, notice: null }
      },
      signOut: async () => {
        await client?.auth.signOut()
      },
    }),
    [client, session, status],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
