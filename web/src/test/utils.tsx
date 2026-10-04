import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../lib/supabase/auth'

export function authValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: 'signedIn',
    email: 'a@test.local',
    getToken: async () => 'token-a',
    signIn: vi.fn().mockResolvedValue({ error: null, notice: null }),
    signUp: vi.fn().mockResolvedValue({ error: null, notice: null }),
    signInWithGoogle: vi.fn().mockResolvedValue({ error: null, notice: null }),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

export function renderAt(
  ui: ReactElement,
  { route = '/', auth = authValue() }: { route?: string; auth?: AuthContextValue } = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}
