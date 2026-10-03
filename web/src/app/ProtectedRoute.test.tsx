import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { authValue, renderAt } from '../test/utils'
import { ProtectedRoute } from './ProtectedRoute'

function renderGuarded(status: Parameters<typeof authValue>[0]) {
  return renderAt(
    <Routes>
      <Route path="/login" element={<p>login page</p>} />
      <Route element={<ProtectedRoute />}>
        <Route index element={<p>secret content</p>} />
      </Route>
    </Routes>,
    { auth: authValue(status) },
  )
}

describe('ProtectedRoute', () => {
  it('shows a loading status while the session is being checked', () => {
    renderGuarded({ status: 'loading' })
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(screen.queryByText('secret content')).not.toBeInTheDocument()
  })

  it('redirects signed-out visitors to /login', () => {
    renderGuarded({ status: 'signedOut', email: null })
    expect(screen.getByText('login page')).toBeInTheDocument()
    expect(screen.queryByText('secret content')).not.toBeInTheDocument()
  })

  it('renders the protected content when signed in', () => {
    renderGuarded({ status: 'signedIn' })
    expect(screen.getByText('secret content')).toBeInTheDocument()
  })

  it('lets visitors in when auth is not configured (local dev)', () => {
    renderGuarded({ status: 'unconfigured', email: null })
    expect(screen.getByText('secret content')).toBeInTheDocument()
  })

  it('shows an alert when the server cannot be reached', () => {
    renderGuarded({ status: 'error', email: null })
    expect(screen.getByRole('alert')).toHaveTextContent("Can't reach the Somada server")
    expect(screen.queryByText('secret content')).not.toBeInTheDocument()
  })
})
