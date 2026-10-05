import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabase } from '../supabase/client'
import { UploadError } from './errors'
import type { HealthData, LifeEvent, ParseResult } from './types'

interface RemoteError {
  message: string
  code?: string
}

function isAuthError(error: RemoteError): boolean {
  return error.code === 'PGRST301' || error.code === 'PGRST303' || /jwt/i.test(error.message)
}

/** The signed-in user's own life events, or [] when they have no row. Never reads the demo row. */
export async function loadOwnEvents(client: SupabaseClient, userId: string): Promise<LifeEvent[]> {
  const { data, error } = await client
    .from('health_data')
    .select('data')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new UploadError(isAuthError(error) ? 'session-expired' : 'save-failed', error.message)
  const events = (data?.data as Partial<HealthData> | null | undefined)?.events
  return Array.isArray(events) ? events : []
}

/** Replace the user's daily data and summary; keep whatever events they already have. */
export async function saveOwnHealth(
  client: SupabaseClient,
  userId: string,
  parsed: ParseResult,
  now: Date = new Date(),
): Promise<void> {
  const events = await loadOwnEvents(client, userId)
  const stamp = now.toISOString()
  const { error } = await client.from('health_data').upsert(
    {
      user_id: userId,
      data: { daily: parsed.daily, summary: parsed.summary, events, generated_at: stamp },
      updated_at: stamp,
    },
    { onConflict: 'user_id' },
  )
  if (error) throw new UploadError(isAuthError(error) ? 'session-expired' : 'save-failed', error.message)
}

export async function saveForCurrentUser(parsed: ParseResult): Promise<void> {
  const client = await getSupabase()
  if (!client) throw new UploadError('not-configured', 'Supabase is not configured')
  const { data } = await client.auth.getSession()
  const userId = data.session?.user.id
  if (!userId) throw new UploadError('session-expired', 'No signed-in user')
  await saveOwnHealth(client, userId, parsed)
}
