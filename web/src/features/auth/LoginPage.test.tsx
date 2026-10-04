import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { authValue, renderAt } from '../../test/utils'
import { LoginPage } from './LoginPage'

function renderLogin(auth = authValue({ status: 'signedOut', email: null })) {
  return renderAt(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<p>home</p>} />
    </Routes>,
    { route: '/login', auth },
  )
}

async function fillCredentials() {
  await userEvent.type(screen.getByLabelText('Email'), 'a@test.local')
  await userEvent.type(screen.getByLabelText('Password'), 'secret1')
}

describe('LoginPage', () => {
  it('signs in with the typed credentials', async () => {
    const signIn = vi.fn().mockResolvedValue({ error: null, notice: null })
    renderLogin(authValue({ status: 'signedOut', email: null, signIn }))
    await fillCredentials()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(signIn).toHaveBeenCalledWith('a@test.local', 'secret1')
  })

  it('shows the error message when sign-in fails', async () => {
    const signIn = vi.fn().mockResolvedValue({ error: 'Invalid login credentials', notice: null })
    renderLogin(authValue({ status: 'signedOut', email: null, signIn }))
    await fillCredentials()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials')
  })

  it('creates an account and shows the confirmation notice', async () => {
    const signUp = vi
      .fn()
      .mockResolvedValue({ error: null, notice: 'Check your email to confirm your account, then sign in.' })
    renderLogin(authValue({ status: 'signedOut', email: null, signUp }))
    await fillCredentials()
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(signUp).toHaveBeenCalledWith('a@test.local', 'secret1')
    expect(await screen.findByRole('status')).toHaveTextContent('Check your email')
  })

  it('offers Google sign-in', async () => {
    const signInWithGoogle = vi.fn().mockResolvedValue({ error: null, notice: null })
    renderLogin(authValue({ status: 'signedOut', email: null, signInWithGoogle }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))
    expect(signInWithGoogle).toHaveBeenCalledTimes(1)
  })

  it('redirects to the dashboard once signed in', () => {
    renderLogin(authValue({ status: 'signedIn' }))
    expect(screen.getByText('home')).toBeInTheDocument()
  })
})
