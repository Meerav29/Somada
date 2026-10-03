import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth, type AuthResult } from '../../lib/supabase/auth'

type Message = { kind: 'error' | 'notice'; text: string }

export function LoginPage() {
  const { status, signIn, signUp, signInWithGoogle } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<Message | null>(null)
  const [busy, setBusy] = useState(false)

  if (status === 'signedIn' || status === 'unconfigured') return <Navigate to="/" replace />

  async function run(action: () => Promise<AuthResult>) {
    setBusy(true)
    setMessage(null)
    const result = await action()
    setBusy(false)
    if (result.error) setMessage({ kind: 'error', text: result.error })
    else if (result.notice) setMessage({ kind: 'notice', text: result.notice })
  }

  return (
    <form
      className="login"
      onSubmit={(e) => {
        e.preventDefault()
        void run(() => signIn(email, password))
      }}
    >
      <h1>Sign in to Somada</h1>
      <label>
        Email
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          required
          minLength={6}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {message && <p role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
      <div className="actions">
        <button type="submit" disabled={busy}>
          Sign in
        </button>
        <button type="button" disabled={busy} onClick={() => void run(() => signUp(email, password))}>
          Create account
        </button>
        <button type="button" disabled={busy} onClick={() => void run(() => signInWithGoogle())}>
          Continue with Google
        </button>
      </div>
    </form>
  )
}
