import { describe, expect, it } from 'vitest'
import config from '../vite.config'

describe('build config', () => {
  it('serves the app under /app/ so it can coexist with the legacy page at /', () => {
    expect(config.base).toBe('/app/')
  })

  // Vitest forces Vite's base to '/' while testing; vite.config.ts pins BASE_URL via test.env
  // so code under test sees the production value.
  it('exposes the production base as import.meta.env.BASE_URL in tests', () => {
    expect(import.meta.env.BASE_URL).toBe('/app/')
  })
})
