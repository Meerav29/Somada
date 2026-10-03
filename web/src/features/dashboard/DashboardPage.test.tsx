import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../../test/fetch'
import { healthFixture } from '../../test/fixtures'
import { authValue, renderAt } from '../../test/utils'
import { DashboardPage } from './DashboardPage'

afterEach(() => {
  vi.unstubAllGlobals()
})

function ownData() {
  const data = healthFixture()
  data.summary.total_days = 120
  return data
}

describe('DashboardPage', () => {
  it('shows a loading status, then the size of the user\'s own dataset', async () => {
    stubFetch(200, ownData())
    renderAt(<DashboardPage />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading your data')
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByText('120 days of data')).toBeInTheDocument()
    expect(screen.queryByText(/sample data/i)).not.toBeInTheDocument()
  })

  it('requests health data with the signed-in user\'s token', async () => {
    const calls = stubFetch(200, ownData())
    renderAt(<DashboardPage />, { auth: authValue({ getToken: async () => 'token-b' }) })
    await screen.findByRole('heading', { name: 'Dashboard' })
    expect(calls[0].url).toBe('/api/health')
    expect(calls[0].headers.get('Authorization')).toBe('Bearer token-b')
  })

  it('labels the shared demo dataset as sample data and links to the classic upload', async () => {
    stubFetch(200, { ...ownData(), is_demo: true })
    renderAt(<DashboardPage />)
    expect(await screen.findByText(/You're viewing sample data/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Upload your own data' })).toHaveAttribute('href', '/')
  })

  it('tells new users there is no data yet when the server has none', async () => {
    stubFetch(200, { error: 'No health data found.' })
    renderAt(<DashboardPage />)
    expect(await screen.findByRole('heading', { name: 'No health data yet' })).toBeInTheDocument()
  })

  it('shows the server error message when the request fails', async () => {
    stubFetch(401, { error: 'Sign in required.' })
    renderAt(<DashboardPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in required.')
  })
})
