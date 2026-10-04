import { useQuery } from '@tanstack/react-query'
import { getHealth } from '../api/client'
import { useAuth } from '../supabase/auth'

/** The signed-in user's health data (own or demo), shared by the dashboard and the upload page. */
export function useHealthQuery() {
  const { email, getToken } = useAuth()
  return useQuery({
    queryKey: ['health', email],
    queryFn: () => getHealth(getToken),
  })
}
