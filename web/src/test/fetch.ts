import { vi } from 'vitest'

export interface RecordedCall {
  url: string
  headers: Headers
}

/** Replace global fetch with a stub that records calls and answers every request with `body` as JSON. */
export function stubFetch(status: number, body: unknown): RecordedCall[] {
  const calls: RecordedCall[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) })
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  return calls
}
