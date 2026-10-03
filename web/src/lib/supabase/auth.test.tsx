import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth, type AuthContextValue } from './auth'

const session = { access_token: 'tok-a', user: { email: 'a@test.local' } } as unknown as Session

function fakeClient(initial: Session | null) {
  let listener: ((event: string, s: Session | null) => void) | undefined
  const unsubscribe = vi.fn()
  const auth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: initial } }),
    onAuthStateChange: vi.fn((cb: (event: string, s: Session | null) => void) => {
      listener = cb
      return { data: { subscription: { unsubscribe } } }
    }),
    signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
    signUp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  }
  return {
    client: { auth } as unknown as SupabaseClient,
    auth,
    unsubscribe,
    emit: (s: Session | null) => listener?.(s ? 'SIGNED_IN' : 'SIGNED_OUT', s),
  }
}

let ctx!: AuthContextValue
function Capture() {
  ctx = useAuth()
  return (
    <>
      <p data-testid="status">{ctx.status}</p>
      <p data-testid="email">{ctx.email ?? ''}</p>
    </>
  )
}

function renderProvider(loadClient: () => Promise<SupabaseClient | null>) {
  return render(
    <AuthProvider loadClient={loadClient}>
      <Capture />
    </AuthProvider>,
  )
}

const expectStatus = (value: string) =>
  waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent(value))

describe('AuthProvider', () => {
  it('starts loading, then reports signedIn with the email when a session exists', async () => {
    const { client } = fakeClient(session)
    renderProvider(async () => client)
    expect(screen.getByTestId('status')).toHaveTextContent('loading')
    await expectStatus('signedIn')
    expect(screen.getByTestId('email')).toHaveTextContent('a@test.local')
  })

  it('reports signedOut when there is no session', async () => {
    const { client } = fakeClient(null)
    renderProvider(async () => client)
    await expectStatus('signedOut')
  })

  it('reports unconfigured when Supabase is not configured (local dev)', async () => {
    renderProvider(async () => null)
    await expectStatus('unconfigured')
    expect(await ctx.getToken()).toBeNull()
  })

  it('reports error when the Supabase config cannot be loaded', async () => {
    renderProvider(async () => {
      throw new Error('network down')
    })
    await expectStatus('error')
  })

  it('follows auth state changes', async () => {
    const { client, emit } = fakeClient(null)
    renderProvider(async () => client)
    await expectStatus('signedOut')
    act(() => emit(session))
    await expectStatus('signedIn')
    act(() => emit(null))
    await expectStatus('signedOut')
  })

  it('getToken returns the current access token', async () => {
    const { client } = fakeClient(session)
    renderProvider(async () => client)
    await expectStatus('signedIn')
    expect(await ctx.getToken()).toBe('tok-a')
  })

  it('signIn forwards credentials and returns the Supabase error message', async () => {
    const { client, auth } = fakeClient(null)
    auth.signInWithPassword.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } })
    renderProvider(async () => client)
    await expectStatus('signedOut')
    let result!: Awaited<ReturnType<AuthContextValue['signIn']>>
    await act(async () => {
      result = await ctx.signIn('a@test.local', 'pw')
    })
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@test.local', password: 'pw' })
    expect(result).toEqual({ error: 'Invalid login credentials', notice: null })
  })

  it('signUp without a session asks the user to confirm their email', async () => {
    const { client } = fakeClient(null)
    renderProvider(async () => client)
    await expectStatus('signedOut')
    let result!: Awaited<ReturnType<AuthContextValue['signUp']>>
    await act(async () => {
      result = await ctx.signUp('new@test.local', 'secret1')
    })
    expect(result.error).toBeNull()
    expect(result.notice).toMatch(/confirm/i)
  })

  it('signUp surfaces Supabase errors', async () => {
    const { client, auth } = fakeClient(null)
    auth.signUp.mockResolvedValueOnce({ data: { session: null }, error: { message: 'User already registered' } })
    renderProvider(async () => client)
    await expectStatus('signedOut')
    let result!: Awaited<ReturnType<AuthContextValue['signUp']>>
    await act(async () => {
      result = await ctx.signUp('a@test.local', 'secret1')
    })
    expect(result).toEqual({ error: 'User already registered', notice: null })
  })

  it('signInWithGoogle redirects back to the SPA base path', async () => {
    const { client, auth } = fakeClient(null)
    renderProvider(async () => client)
    await expectStatus('signedOut')
    await act(async () => {
      await ctx.signInWithGoogle()
    })
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/app/` },
    })
  })

  it('signOut signs out of Supabase', async () => {
    const { client, auth } = fakeClient(session)
    renderProvider(async () => client)
    await expectStatus('signedIn')
    await act(async () => {
      await ctx.signOut()
    })
    expect(auth.signOut).toHaveBeenCalled()
  })

  it('unsubscribes from auth changes on unmount', async () => {
    const { client, unsubscribe } = fakeClient(null)
    const { unmount } = renderProvider(async () => client)
    await expectStatus('signedOut')
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })
})
