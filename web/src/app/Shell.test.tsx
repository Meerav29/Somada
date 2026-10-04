import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { authValue, renderAt } from '../test/utils'
import { Shell } from './Shell'

function renderShell(auth = authValue()) {
  return renderAt(
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<p>page body</p>} />
      </Route>
    </Routes>,
    { auth },
  )
}

describe('Shell', () => {
  it('has persistent navigation to Dashboard, Insights and Settings', () => {
    renderShell()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(nav).toContainElement(screen.getByRole('link', { name: 'Dashboard' }))
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Insights' })).toHaveAttribute('href', '/insights')
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
    expect(screen.getByText('page body')).toBeInTheDocument()
  })

  it('shows the account email and signs out on request', async () => {
    const signOut = vi.fn().mockResolvedValue(undefined)
    renderShell(authValue({ signOut }))
    expect(screen.getByText('a@test.local')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('hides the account area when auth is not configured', () => {
    renderShell(authValue({ status: 'unconfigured', email: null }))
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })
})
