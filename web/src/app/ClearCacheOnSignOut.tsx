import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useAuth } from '../lib/supabase/auth'

export function ClearCacheOnSignOut() {
  const { status } = useAuth()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (status === 'signedOut') {
      queryClient.clear()
    }
  }, [status, queryClient])

  return null
}
