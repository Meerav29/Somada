import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/supabase/auth'

export function Shell() {
  const { status, email, signOut } = useAuth()
  return (
    <div className="shell">
      <header className="shell-header">
        <span className="brand">Somada</span>
        <nav aria-label="Main">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/insights">Insights</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        {status === 'signedIn' && (
          <div className="account">
            <span>{email}</span>
            <button type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        )}
      </header>
      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  )
}
