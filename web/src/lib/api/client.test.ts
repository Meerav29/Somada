import { afterEach, describe, expect, it, vi } from 'vitest'
import { healthFixture } from '../../test/fixtures'
import { stubFetch } from '../../test/fetch'
import { ApiError, getAppConfig, getHealth, getSupabaseConfig } from './client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getHealth', () => {
  it('sends the access token as a Bearer header', async () => {
    const calls = stubFetch(200, healthFixture())
    await getHealth(async () => 'tok-a')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/api/health')
    expect(calls[0].headers.get('Authorization')).toBe('Bearer tok-a')
  })

  it('omits Authorization when there is no token (unconfigured local dev)', async () => {
    const calls = stubFetch(200, healthFixture())
    await getHealth(async () => null)
    expect(calls[0].headers.has('Authorization')).toBe(false)
  })

  it('returns the data, including the server-set is_demo marker', async () => {
    stubFetch(200, healthFixture({ is_demo: true }))
    const data = await getHealth(async () => 'tok-a')
    expect(data?.is_demo).toBe(true)
    expect(data?.summary.total_days).toBe(1)
  })

  it('returns null when the server answers 200 with an error body (no data yet)', async () => {
    stubFetch(200, { error: 'No health data found.' })
    expect(await getHealth(async () => 'tok-a')).toBeNull()
  })

  it('throws ApiError with the server message on 401', async () => {
    stubFetch(401, { error: 'Sign in required.' })
    await expect(getHealth(async () => null)).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      message: 'Sign in required.',
    })
  })

  it('falls back to a generic message when the error body has no message', async () => {
    stubFetch(500, null)
    await expect(getHealth(async () => 'tok-a')).rejects.toBeInstanceOf(ApiError)
    await expect(getHealth(async () => 'tok-a')).rejects.toMatchObject({
      message: 'Request failed (500)',
    })
  })

  it('treats an empty 200 body as an error instead of crashing', async () => {
    stubFetch(200, null)
    await expect(getHealth(async () => 'tok-a')).rejects.toMatchObject({ status: 200 })
  })
})

describe('public config endpoints', () => {
  it('getSupabaseConfig calls /api/supabase_config without credentials', async () => {
    const calls = stubFetch(200, { url: 'https://x.supabase.co', anonKey: 'k' })
    const cfg = await getSupabaseConfig()
    expect(cfg).toEqual({ url: 'https://x.supabase.co', anonKey: 'k' })
    expect(calls[0].url).toBe('/api/supabase_config')
    expect(calls[0].headers.has('Authorization')).toBe(false)
  })

  it('getAppConfig calls /api/config', async () => {
    const calls = stubFetch(200, { chat: { byokSupported: true } })
    await getAppConfig()
    expect(calls[0].url).toBe('/api/config')
  })
})
