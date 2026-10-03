import type { HealthData } from '../health/types'

export type TokenProvider = () => Promise<string | null>

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export interface SupabaseConfig {
  url: string
  anonKey: string
}

export interface ChatConfig {
  serverVertex: boolean
  serverModel: string
  serverClaude: boolean
  claudeModel: string
  byokSupported: boolean
}

export interface AppConfig {
  chat: ChatConfig
}

function errorMessage(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const { error } = body as { error: unknown }
    if (typeof error === 'string') return error
  }
  return `Request failed (${status})`
}

async function request<T>(path: string, getToken: TokenProvider | null): Promise<T> {
  const headers = new Headers()
  if (getToken) {
    const token = await getToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  const res = await fetch(path, { headers })
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, errorMessage(body, res.status))
  if (typeof body !== 'object' || body === null) throw new ApiError(res.status, 'Unexpected response')
  return body as T
}

export function getSupabaseConfig(): Promise<SupabaseConfig> {
  return request<SupabaseConfig>('/api/supabase_config', null)
}

export function getAppConfig(): Promise<AppConfig> {
  return request<AppConfig>('/api/config', null)
}

/** The caller's health data, or null when the server has none for them yet. */
export async function getHealth(getToken: TokenProvider): Promise<HealthData | null> {
  const body = await request<HealthData | { error: string }>('/api/health', getToken)
  return 'error' in body ? null : body
}
