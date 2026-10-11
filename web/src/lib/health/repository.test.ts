import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { healthFixture } from '../../test/fixtures'
import type { LifeEvent, ParseResult } from './types'

const getSupabase = vi.fn()
vi.mock('../supabase/client', () => ({ getSupabase: () => getSupabase() }))

import { loadOwnEvents, saveForCurrentUser, saveOwnHealth } from './repository'

const EVENT: LifeEvent = { label: 'Exam week', start: '2026-01-05', end: '2026-01-12', color: '#ef4444', icon: 'books' }

function parsed(): ParseResult {
  const h = healthFixture()
  return {
    daily: h.daily,
    summary: h.summary,
    stats: { recordsSeen: 1, recordsKept: 1, firstDate: '2026-09-30', lastDate: '2026-09-30', bytesRead: 10, maxCarryBytes: 0 },
  }
}

interface FakeOptions {
  existing?: unknown
  selectError?: { message: string; code?: string } | null
  upsertError?: { message: string; code?: string } | null
}

function fakeClient(opts: FakeOptions = {}) {
  const calls = {
    from: [] as string[],
    selectEq: [] as [string, string][],
    upserts: [] as { row: Record<string, unknown>; options: unknown }[],
  }
  const client = {
    from: (table: string) => {
      calls.from.push(table)
      return {
        select: () => ({
          eq: (column: string, value: string) => {
            calls.selectEq.push([column, value])
            return {
              maybeSingle: async () => ({ data: opts.existing ?? null, error: opts.selectError ?? null }),
            }
          },
        }),
        upsert: async (row: Record<string, unknown>, options: unknown) => {
          calls.upserts.push({ row, options })
          return { error: opts.upsertError ?? null }
        },
      }
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

describe('loadOwnEvents', () => {
  it("returns the user's existing events", async () => {
    const { client } = fakeClient({ existing: { data: { events: [EVENT] } } })
    expect(await loadOwnEvents(client, 'user-a')).toEqual([EVENT])
  })

  it('returns [] when the user has no row yet', async () => {
    const { client } = fakeClient({ existing: null })
    expect(await loadOwnEvents(client, 'user-a')).toEqual([])
  })

  it('returns [] when the stored events are missing or malformed', async () => {
    for (const existing of [{ data: {} }, { data: { events: 'nope' } }, { data: null }]) {
      const { client } = fakeClient({ existing })
      expect(await loadOwnEvents(client, 'user-a')).toEqual([])
    }
  })

  it("only ever reads the signed-in user's own row, never the demo row", async () => {
    const { client, calls } = fakeClient({ existing: { data: { events: [EVENT] } } })
    await loadOwnEvents(client, 'user-a')
    expect(calls.from).toEqual(['health_data'])
    expect(calls.selectEq).toEqual([['user_id', 'user-a']])
  })

  it('turns a read error into save-failed', async () => {
    const { client } = fakeClient({ selectError: { message: 'boom' } })
    await expect(loadOwnEvents(client, 'user-a')).rejects.toMatchObject({ code: 'save-failed' })
  })

  it.each([
    [{ message: 'JWT expired', code: 'PGRST303' }, 'session-expired'],
    [{ message: 'JWT expired', code: 'PGRST301' }, 'session-expired'],
    [{ message: 'boom' }, 'save-failed'],
  ])('maps read error %j to %s (also through saveOwnHealth)', async (selectError, code) => {
    const { client, calls } = fakeClient({ selectError })
    await expect(loadOwnEvents(client, 'user-a')).rejects.toMatchObject({ code })
    await expect(saveOwnHealth(client, 'user-a', parsed())).rejects.toMatchObject({ code })
    expect(calls.upserts).toHaveLength(0)
  })
})

describe('saveOwnHealth', () => {
  const NOW = new Date('2026-10-04T10:00:00Z')

  it('upserts the parsed data with the existing events and a fresh updated_at', async () => {
    const { client, calls } = fakeClient({ existing: { data: { events: [EVENT] } } })
    const result = parsed()
    await saveOwnHealth(client, 'user-a', result, NOW)
    expect(calls.upserts).toHaveLength(1)
    expect(calls.upserts[0].options).toEqual({ onConflict: 'user_id' })
    expect(calls.upserts[0].row).toEqual({
      user_id: 'user-a',
      data: {
        daily: result.daily,
        summary: result.summary,
        events: [EVENT],
        generated_at: NOW.toISOString(),
      },
      updated_at: NOW.toISOString(),
    })
  })

  it('starts a new user with no events', async () => {
    const { client, calls } = fakeClient({ existing: null })
    await saveOwnHealth(client, 'user-a', parsed(), NOW)
    const data = calls.upserts[0].row.data as { events: unknown }
    expect(data.events).toEqual([])
  })

  it('does not store parse stats', async () => {
    const { client, calls } = fakeClient()
    await saveOwnHealth(client, 'user-a', parsed(), NOW)
    expect(Object.keys(calls.upserts[0].row.data as object).sort()).toEqual(
      ['daily', 'events', 'generated_at', 'summary'],
    )
  })

  it.each([
    [{ message: 'JWT expired', code: 'PGRST303' }, 'session-expired'],
    [{ message: 'JWT expired', code: 'PGRST301' }, 'session-expired'],
    [{ message: 'invalid jwt claims' }, 'session-expired'],
    [{ message: 'new row violates row-level security policy', code: '42501' }, 'save-failed'],
    [{ message: 'network down' }, 'save-failed'],
  ])('maps upsert error %j to %s', async (upsertError, code) => {
    const { client } = fakeClient({ upsertError })
    await expect(saveOwnHealth(client, 'user-a', parsed(), NOW)).rejects.toMatchObject({ code })
  })
})

describe('saveForCurrentUser', () => {
  beforeEach(() => {
    getSupabase.mockReset()
  })

  it('refuses when Supabase is not configured', async () => {
    getSupabase.mockResolvedValue(null)
    await expect(saveForCurrentUser(parsed())).rejects.toMatchObject({ code: 'not-configured' })
  })

  it('reports an expired session when nobody is signed in', async () => {
    const { client } = fakeClient()
    ;(client as unknown as { auth: unknown }).auth = { getSession: async () => ({ data: { session: null } }) }
    getSupabase.mockResolvedValue(client)
    await expect(saveForCurrentUser(parsed())).rejects.toMatchObject({ code: 'session-expired' })
  })

  it('saves for the signed-in user', async () => {
    const { client, calls } = fakeClient()
    ;(client as unknown as { auth: unknown }).auth = {
      getSession: async () => ({ data: { session: { user: { id: 'user-a' } } } }),
    }
    getSupabase.mockResolvedValue(client)
    await saveForCurrentUser(parsed())
    expect(calls.upserts).toHaveLength(1)
    expect(calls.upserts[0].row.user_id).toBe('user-a')
  })
})
