import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api/client'

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) {
    const status = error.status
    if (status >= 400 && status < 500) {
      return false
    }
  }
  return failureCount < 2
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        refetchOnWindowFocus: false,
      },
    },
  })
}
