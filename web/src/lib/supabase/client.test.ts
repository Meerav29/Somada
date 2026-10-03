import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSupabaseConfig = vi.fn()
const createClient = vi.fn()

vi.mock('../api/client', () => ({ getSupabaseConfig: () => getSupabaseConfig() }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string) => createClient(url, key),
}))

beforeEach(() => {
  vi.resetModules()
  getSupabaseConfig.mockReset()
  createClient.mockReset()
})

async function load() {
  return (await import('./client')).getSupabase
}

describe('getSupabase', () => {
  it('resolves null without creating a client when url is empty', async () => {
    getSupabaseConfig.mockResolvedValue({ url: '', anonKey: 'k' })
    const getSupabase = await load()
    expect(await getSupabase()).toBeNull()
    expect(createClient).not.toHaveBeenCalled()
  })

  it('resolves null when anonKey is empty', async () => {
    getSupabaseConfig.mockResolvedValue({ url: 'https://x.supabase.co', anonKey: '' })
    const getSupabase = await load()
    expect(await getSupabase()).toBeNull()
    expect(createClient).not.toHaveBeenCalled()
  })

  it('creates the client once and reuses it', async () => {
    const sentinel = { sentinel: true }
    createClient.mockReturnValue(sentinel)
    getSupabaseConfig.mockResolvedValue({ url: 'https://x.supabase.co', anonKey: 'k' })
    const getSupabase = await load()
    expect(await getSupabase()).toBe(sentinel)
    expect(await getSupabase()).toBe(sentinel)
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(createClient).toHaveBeenCalledWith('https://x.supabase.co', 'k')
    expect(getSupabaseConfig).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed config fetch and retries on the next call', async () => {
    const sentinel = { sentinel: true }
    createClient.mockReturnValue(sentinel)
    getSupabaseConfig
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ url: 'https://x.supabase.co', anonKey: 'k' })
    const getSupabase = await load()
    await expect(getSupabase()).rejects.toThrow('boom')
    expect(await getSupabase()).toBe(sentinel)
    expect(getSupabaseConfig).toHaveBeenCalledTimes(2)
  })
})
