import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseConfig } from '../api/client'

let clientPromise: Promise<SupabaseClient | null> | null = null

/**
 * The Supabase client, built once from the runtime config served by the API.
 * Resolves to null when Supabase is not configured (local dev). A failed config
 * fetch is not cached, so the next call retries.
 */
export function getSupabase(): Promise<SupabaseClient | null> {
  clientPromise ??= getSupabaseConfig()
    .then((cfg) => (cfg.url && cfg.anonKey ? createClient(cfg.url, cfg.anonKey) : null))
    .catch((err: unknown) => {
      clientPromise = null
      throw err
    })
  return clientPromise
}
