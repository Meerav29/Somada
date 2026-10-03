import { describe, expect, it } from 'vitest'
import { ApiError } from './api/client'
import { createQueryClient, shouldRetry } from './queryClient'

describe('shouldRetry', () => {
  it('returns false for ApiError with 401 status at failureCount 0', () => {
    const error = new ApiError(401, 'Unauthorized')
    expect(shouldRetry(0, error)).toBe(false)
  })

  it('returns false for ApiError with 4xx status', () => {
    const error400 = new ApiError(400, 'Bad Request')
    const error403 = new ApiError(403, 'Forbidden')
    const error404 = new ApiError(404, 'Not Found')
    expect(shouldRetry(0, error400)).toBe(false)
    expect(shouldRetry(0, error403)).toBe(false)
    expect(shouldRetry(0, error404)).toBe(false)
  })

  it('returns true for ApiError with 5xx status at failureCount 0 and 1', () => {
    const error = new ApiError(500, 'Server Error')
    expect(shouldRetry(0, error)).toBe(true)
    expect(shouldRetry(1, error)).toBe(true)
  })

  it('returns false for ApiError with 5xx status at failureCount 2', () => {
    const error = new ApiError(500, 'Server Error')
    expect(shouldRetry(2, error)).toBe(false)
  })

  it('returns true for non-ApiError at failureCount 0 and 1', () => {
    const error = new TypeError('Network error')
    expect(shouldRetry(0, error)).toBe(true)
    expect(shouldRetry(1, error)).toBe(true)
  })

  it('returns false for non-ApiError at failureCount 2', () => {
    const error = new TypeError('Network error')
    expect(shouldRetry(2, error)).toBe(false)
  })
})

describe('createQueryClient', () => {
  it('creates a QueryClient with shouldRetry as retry function', () => {
    const queryClient = createQueryClient()
    const retryFn = queryClient.getDefaultOptions().queries?.retry
    expect(retryFn).toBe(shouldRetry)
  })

  it('sets refetchOnWindowFocus to false', () => {
    const queryClient = createQueryClient()
    const refetchOnWindowFocus = queryClient.getDefaultOptions().queries?.refetchOnWindowFocus
    expect(refetchOnWindowFocus).toBe(false)
  })
})
