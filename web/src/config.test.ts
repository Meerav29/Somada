import { describe, expect, it } from 'vitest'

describe('build config', () => {
  it('serves the app under /app/ so it can coexist with the legacy page at /', () => {
    expect(import.meta.env.BASE_URL).toBe('/app/')
  })
})
