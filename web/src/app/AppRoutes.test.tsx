import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fetch'
import { healthFixture } from '../test/fixtures'
import { authValue, renderAt } from '../test/utils'
import { AppRoutes } from './AppRoutes'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AppRoutes', () => {
  it('sends signed-out visitors to the login page', () => {
    renderAt(<AppRoutes />, { auth: authValue({ status: 'signedOut', email: null }) })
    expect(screen.getByRole('heading', { name: 'Sign in to Somada' })).toBeInTheDocument()
  })

  it('renders the dashboard inside the shell for signed-in users', async () => {
    stubFetch(200, healthFixture())
    renderAt(<AppRoutes />)
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })

  it('serves the Insights and Settings placeholders', () => {
    renderAt(<AppRoutes />, { route: '/insights' })
    expect(screen.getByRole('heading', { name: 'Insights' })).toBeInTheDocument()
  })

  it('redirects unknown paths to the dashboard', async () => {
    stubFetch(200, healthFixture())
    renderAt(<AppRoutes />, { route: '/nope' })
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })
})
