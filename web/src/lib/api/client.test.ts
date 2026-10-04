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

  it('rejects a non-object JSON body', async () => {
    stubFetch(200, 'ok')
    await expect(getHealth(async () => 'tok-a')).rejects.toMatchObject({
      name: 'ApiError',
      status: 200,
      message: 'Unexpected response',
    })
  })

  it('passes null metrics and summary stats through unchanged', async () => {
    const payload = {
      daily: {
        '2026-09-29': {
          date: '2026-09-29',
          steps: null,
          heart_rate_avg: null,
          heart_rate_min: null,
          heart_rate_max: null,
          resting_hr: null,
          hrv: null,
          sleep_hours: null,
          active_calories: null,
          exercise_minutes: null,
          spo2: null,
        },
      },
      summary: {
        avg_steps: null,
        avg_sleep_hours: null,
        avg_resting_hr: null,
        avg_hrv: null,
        best_sleep: null,
        worst_sleep: null,
        best_steps_day: null,
        total_days: 1,
      },
      events: [],
      generated_at: '2026-09-30T00:00:00',
    }
    stubFetch(200, payload)
    expect(await getHealth(async () => 'tok-a')).toEqual(payload)
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
