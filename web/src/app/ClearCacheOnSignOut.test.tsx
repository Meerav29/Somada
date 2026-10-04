import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { AuthContext } from '../lib/supabase/auth'
import { ClearCacheOnSignOut } from './ClearCacheOnSignOut'

describe('ClearCacheOnSignOut', () => {
  it('clears the query cache when user signs out', () => {
    const queryClient = new QueryClient()
    const testData = { summary: { total_days: 100 } }
    queryClient.setQueryData(['health', 'a@test.local'], testData)

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider
          value={{
            status: 'signedIn',
            email: 'a@test.local',
            getToken: vi.fn(),
            signIn: vi.fn(),
            signUp: vi.fn(),
            signInWithGoogle: vi.fn(),
            signOut: vi.fn(),
          }}
        >
          <ClearCacheOnSignOut />
          <div>test</div>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    expect(queryClient.getQueryData(['health', 'a@test.local'])).toEqual(testData)

    rerender(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider
          value={{
            status: 'signedOut',
            email: null,
            getToken: vi.fn(),
            signIn: vi.fn(),
            signUp: vi.fn(),
            signInWithGoogle: vi.fn(),
            signOut: vi.fn(),
          }}
        >
          <ClearCacheOnSignOut />
          <div>test</div>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    expect(queryClient.getQueryData(['health', 'a@test.local'])).toBeUndefined()
  })

  it('does not clear cache while status is signedIn', () => {
    const queryClient = new QueryClient()
    const testData = { summary: { total_days: 100 } }
    queryClient.setQueryData(['health', 'a@test.local'], testData)

    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider
          value={{
            status: 'signedIn',
            email: 'a@test.local',
            getToken: vi.fn(),
            signIn: vi.fn(),
            signUp: vi.fn(),
            signInWithGoogle: vi.fn(),
            signOut: vi.fn(),
          }}
        >
          <ClearCacheOnSignOut />
          <div>test</div>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    expect(queryClient.getQueryData(['health', 'a@test.local'])).toEqual(testData)
  })

  it('does not clear cache while status is loading', () => {
    const queryClient = new QueryClient()
    const testData = { summary: { total_days: 100 } }
    queryClient.setQueryData(['health', 'a@test.local'], testData)

    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider
          value={{
            status: 'loading',
            email: null,
            getToken: vi.fn(),
            signIn: vi.fn(),
            signUp: vi.fn(),
            signInWithGoogle: vi.fn(),
            signOut: vi.fn(),
          }}
        >
          <ClearCacheOnSignOut />
          <div>test</div>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    expect(queryClient.getQueryData(['health', 'a@test.local'])).toEqual(testData)
  })
})
