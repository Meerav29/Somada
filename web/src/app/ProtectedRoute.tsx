import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/supabase/auth'

export function ProtectedRoute() {
  const { status } = useAuth()
  if (status === 'loading') return <p role="status">Loading…</p>
  if (status === 'error') {
    return <p role="alert">Can't reach the Somada server. Try again in a moment.</p>
  }
  if (status === 'signedOut') return <Navigate to="/login" replace />
  return <Outlet />
}
