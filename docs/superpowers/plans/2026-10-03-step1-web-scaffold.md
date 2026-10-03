# Step 1: New Frontend Scaffold (`web/`) with Auth and Shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Vite + React + TypeScript app in `web/`, served at `/app/` next to the untouched legacy page at `/`, with working Supabase sign-in (email/password and Google), a persistent app shell (Dashboard / Insights / Settings), and a dashboard placeholder that proves the authenticated `/api/health` round trip including the demo-data banner.

**Architecture:** A typed API client attaches the user's Supabase JWT to `/api/*` calls. A `AuthProvider` loads the Supabase client at runtime from `/api/supabase_config` (so no build-time env vars) and exposes status/session/actions through context. React Router (basename `/app`) guards routes with a `ProtectedRoute`; TanStack Query fetches health data. A tiny Node script assembles `public/` (legacy page at `/`, built SPA at `/app/`) for Vercel; the Python API is untouched.

**Tech Stack:** Vite, React, TypeScript (strict), React Router (`react-router-dom`), TanStack Query, `@supabase/supabase-js`, Vitest + Testing Library (jsdom), ESLint (flat config, typescript-eslint). Node >= 20.19 (dev machine has 22.18).

**Spec:** `docs/superpowers/specs/2026-10-03-somada-modernization-design.md` (sections "New frontend (`web/`)" and "Rollout" step 2). This is plan 2 of 6; Step 0 (privacy fix) is merged to `master` (PR #1).

## Global Constraints

- Frontend stack per spec: "Vite, React, TypeScript (strict), React Router, TanStack Query, a charting library behind a thin wrapper, Vitest, one Playwright smoke test. Supabase JS from npm." This plan covers everything except the charting library and Playwright (out of scope, see below).
- The legacy `index.html` and the `/api/*` Python functions keep working unchanged throughout; this plan must not edit `index.html` or anything under `api/`.
- "`vercel.json` routes `/api/*` to Python and the rest to the SPA, with the legacy page at `/legacy` until cutover." Ruling for Steps 1-4 (needs user confirmation, see Task 8): the legacy page stays at `/` and the new app lives at `/app/`; the swap to `/` happens at cutover (Step 6).
- TypeScript `strict: true`; no `any`, no `@ts-ignore`.
- No secrets in the bundle: Supabase URL/anon key are fetched at runtime from `/api/supabase_config`; BYOK keys are not touched in this plan.
- When `/api/supabase_config` returns no URL/key (local dev), the app runs unauthenticated (status `unconfigured`), matching the API's local-dev behavior.
- Existing Python CI job (`api`) must keep passing; new CI job `web` runs lint, typecheck, tests and build.
- Commit messages end with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Work on branch `feat/web-scaffold` (default branch is `master`).

**Out of scope (later plans):** XML parsing worker, onboarding/upload flow, charts and the charting library choice (Recharts vs Chart.js), real dashboard views, chat/BYOK UI, life-event editing, Playwright smoke test, rate limiting, cutover to `/`.

## File Structure

```text
web/
  package.json, package-lock.json
  index.html
  tsconfig.json
  vite.config.ts            # base '/app/', dev proxy /api -> :3000, vitest config
  eslint.config.js
  src/
    main.tsx                # providers + render
    styles.css
    config.test.ts          # guards the /app/ base
    lib/
      health/types.ts       # HealthData & friends (shape from CLAUDE.md)
      api/client.ts         # request(), getSupabaseConfig/getAppConfig/getHealth, ApiError
      api/client.test.ts
      supabase/client.ts    # getSupabase(): cached runtime client or null
      supabase/auth.tsx     # AuthContext, AuthProvider, useAuth
      supabase/auth.test.tsx
    app/
      AppRoutes.tsx         # route table
      AppRoutes.test.tsx
      ProtectedRoute.tsx    (+ .test.tsx)
      Shell.tsx             (+ .test.tsx)
      PlaceholderPage.tsx
    features/
      auth/LoginPage.tsx    (+ .test.tsx)
      dashboard/DashboardPage.tsx (+ .test.tsx)
    test/
      setup.ts              # jest-dom matchers
      fetch.ts              # stubFetch(): records calls, returns canned JSON
      fixtures.ts           # healthFixture()
      utils.tsx             # authValue(), renderAt()
scripts/build-site.mjs      # assembles public/ (legacy at /, SPA at /app/)
vercel.json, .gitignore, .vercelignore   # MODIFY
.github/workflows/tests.yml              # MODIFY: add `web` job
README.md, CLAUDE.md, spec               # MODIFY: docs
```

---

### Task 1: Toolchain scaffold (Vite, React, TS, ESLint, Vitest)

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/eslint.config.js`, `web/index.html`, `web/src/main.tsx`, `web/src/test/setup.ts`, `web/src/config.test.ts`
- Modify: `.gitignore` (append), `.vercelignore` (append)

**Interfaces:**
- Produces: working `npm --prefix web run {dev,build,typecheck,lint,test}`; Vitest globals + jsdom + jest-dom matchers; Vite `base: '/app/'` (`import.meta.env.BASE_URL === '/app/'`); dev proxy `/api` -> `http://localhost:3000`.

- [ ] **Step 1: Create the branch**

```bash
cd /c/Users/meera/Github-Projects/Somada
git checkout master && git pull origin master && git checkout -b feat/web-scaffold
mkdir -p web/src/test
```

- [ ] **Step 2: Write `web/package.json`** (dependencies are added by `npm install` in Step 3)

```json
{
  "name": "somada-web",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "engines": { "node": ">=20.19" },
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 3: Install dependencies** (generates the lockfile; use the latest versions npm resolves)

```bash
cd web
npm install react react-dom react-router-dom @tanstack/react-query @supabase/supabase-js
npm install -D vite @vitejs/plugin-react typescript vitest jsdom \
  @testing-library/react @testing-library/jest-dom @testing-library/user-event \
  @types/react @types/react-dom eslint @eslint/js typescript-eslint eslint-plugin-react-hooks
cd ..
```
Expected: `web/node_modules`, `web/package-lock.json`, and `dependencies`/`devDependencies` added to `web/package.json`. If an install fails on peer-dependency conflicts, report it instead of using `--force`.

- [ ] **Step 4: Write the configs**

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`web/vite.config.ts`:
```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// The SPA is served under /app/ so it can sit next to the legacy page at / until cutover.
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  server: {
    // `vercel dev` serves the Python API on :3000
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
})
```

`web/eslint.config.js`:
```js
import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
)
```

`web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="/icon.png" />
    <title>Somada</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/src/main.tsx` (placeholder; replaced in Task 5):
```tsx
import { createRoot } from 'react-dom/client'

createRoot(document.getElementById('root')!).render(<h1>Somada</h1>)
```

`web/src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 5: Write the failing guard test** — `web/src/config.test.ts`

```ts
import { describe, expect, it } from 'vitest'

describe('build config', () => {
  it('serves the app under /app/ so it can coexist with the legacy page at /', () => {
    expect(import.meta.env.BASE_URL).toBe('/app/')
  })
})
```

- [ ] **Step 6: Run the toolchain checks**

Run: `npm --prefix web test` -> Expected: 1 passed.
Run: `npm --prefix web run lint` -> Expected: exit 0, no errors.
Run: `npm --prefix web run typecheck` -> Expected: exit 0.
Run: `npm --prefix web run build` -> Expected: `web/dist/index.html` and `web/dist/assets/*.js` exist; script URLs in `web/dist/index.html` start with `/app/assets/`.

If `typecheck` complains about a `types` entry that is not found, remove only that entry from `tsconfig.json` and report it.

- [ ] **Step 7: Ignore build output**

Append to `.gitignore`:
```text

# New frontend
web/node_modules/
web/dist/
public/
```
Append to `.vercelignore`:
```text
web/node_modules
```

- [ ] **Step 8: Commit**

```bash
git add web .gitignore .vercelignore
git commit -m "feat(web): scaffold Vite + React + TypeScript app served under /app/"
```

---

### Task 2: Health types and typed API client

**Files:**
- Create: `web/src/lib/health/types.ts`, `web/src/lib/api/client.ts`, `web/src/lib/api/client.test.ts`, `web/src/test/fetch.ts`, `web/src/test/fixtures.ts`

**Interfaces:**
- Produces (`types.ts`): `DailyEntry`, `HealthSummary`, `LifeEvent`, `HealthData` (with optional `is_demo?: boolean`, set by the server for the shared demo row).
- Produces (`client.ts`):
  - `type TokenProvider = () => Promise<string | null>`
  - `class ApiError extends Error { readonly status: number }` (`name === 'ApiError'`)
  - `interface SupabaseConfig { url: string; anonKey: string }`, `interface ChatConfig {...}`, `interface AppConfig { chat: ChatConfig }`
  - `getSupabaseConfig(): Promise<SupabaseConfig>` (no auth header)
  - `getAppConfig(): Promise<AppConfig>` (no auth header)
  - `getHealth(getToken: TokenProvider): Promise<HealthData | null>` — `null` when the server answers 200 with `{ "error": ... }` ("No health data found."); throws `ApiError` on non-2xx (e.g. 401 `{"error":"Sign in required."}` -> message `Sign in required.`).
- Produces (test helpers): `stubFetch(status: number, body: unknown): { url: string; headers: Headers }[]` — installs a global `fetch` stub, returns the live array of recorded calls; `healthFixture(overrides?: Partial<HealthData>): HealthData`.

- [ ] **Step 1: Write the types** — `web/src/lib/health/types.ts`

```ts
// Shape documented in CLAUDE.md ("Health Data Shape"). `daily` is a dictionary keyed by date, not an array.
export interface DailyEntry {
  date: string
  steps: number
  resting_hr: number
  hrv: number
  sleep_hours: number
  active_calories: number
  exercise_minutes: number
  spo2: number
}

export interface HealthSummary {
  avg_steps: number
  avg_sleep_hours: number
  avg_resting_hr: number
  avg_hrv: number
  best_sleep: number
  worst_sleep: number
  best_steps_day: string
  total_days: number
}

export interface LifeEvent {
  label: string
  start: string
  end: string
  color: string
  icon: string
}

export interface HealthData {
  daily: Record<string, DailyEntry>
  summary: HealthSummary
  events: LifeEvent[]
  generated_at: string
  /** Set by the server when this is the shared synthetic demo dataset rather than the user's own data. */
  is_demo?: boolean
}
```

- [ ] **Step 2: Write the test helpers**

`web/src/test/fetch.ts`:
```ts
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
```

`web/src/test/fixtures.ts`:
```ts
import type { HealthData } from '../lib/health/types'

export function healthFixture(overrides: Partial<HealthData> = {}): HealthData {
  return {
    daily: {
      '2026-09-30': {
        date: '2026-09-30',
        steps: 8000,
        resting_hr: 61,
        hrv: 48,
        sleep_hours: 7.1,
        active_calories: 420,
        exercise_minutes: 35,
        spo2: 97.5,
      },
    },
    summary: {
      avg_steps: 8000,
      avg_sleep_hours: 7.1,
      avg_resting_hr: 61,
      avg_hrv: 48,
      best_sleep: 7.1,
      worst_sleep: 7.1,
      best_steps_day: '2026-09-30',
      total_days: 1,
    },
    events: [],
    generated_at: '2026-09-30T00:00:00',
    ...overrides,
  }
}
```

- [ ] **Step 3: Write the failing tests** — `web/src/lib/api/client.test.ts`

```ts
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
```

- [ ] **Step 4: Run to verify failure**

Run: `npm --prefix web test -- src/lib/api/client.test.ts`
Expected: FAIL, cannot resolve `./client`.

- [ ] **Step 5: Implement** — `web/src/lib/api/client.ts`

```ts
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
  if (body === null) throw new ApiError(res.status, 'Unexpected empty response')
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
```

- [ ] **Step 6: Run to verify pass, then the full checks**

Run: `npm --prefix web test` -> Expected: all PASS.
Run: `npm --prefix web run lint && npm --prefix web run typecheck` -> Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add web/src
git commit -m "feat(web): health types and typed API client with Bearer auth"
```

---

### Task 3: Supabase client and AuthProvider

**Files:**
- Create: `web/src/lib/supabase/client.ts`, `web/src/lib/supabase/auth.tsx`, `web/src/lib/supabase/auth.test.tsx`

**Interfaces:**
- Consumes: `getSupabaseConfig` from `../api/client`.
- Produces (`client.ts`): `getSupabase(): Promise<SupabaseClient | null>` — resolves a cached client, or `null` when the config has no URL/key; a failed config fetch is not cached (next call retries).
- Produces (`auth.tsx`):
  - `type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'unconfigured' | 'error'`
  - `interface AuthResult { error: string | null; notice: string | null }`
  - `interface AuthContextValue { status: AuthStatus; email: string | null; getToken: () => Promise<string | null>; signIn(email: string, password: string): Promise<AuthResult>; signUp(email: string, password: string): Promise<AuthResult>; signInWithGoogle(): Promise<AuthResult>; signOut(): Promise<void> }`
  - `AuthContext` (React context, exported for tests), `AuthProvider({ children, loadClient? })` (`loadClient` defaults to `getSupabase`; injectable for tests), `useAuth(): AuthContextValue` (throws outside a provider).
  - Google redirect target: `${window.location.origin}${import.meta.env.BASE_URL}` (i.e. `.../app/`).

- [ ] **Step 1: Write the failing tests** — `web/src/lib/supabase/auth.test.tsx`

```tsx
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth, type AuthContextValue } from './auth'

const session = { access_token: 'tok-a', user: { email: 'a@test.local' } } as unknown as Session

function fakeClient(initial: Session | null) {
  let listener: ((event: string, s: Session | null) => void) | undefined
  const unsubscribe = vi.fn()
  const auth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: initial } }),
    onAuthStateChange: vi.fn((cb: (event: string, s: Session | null) => void) => {
      listener = cb
      return { data: { subscription: { unsubscribe } } }
    }),
    signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
    signUp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  }
  return {
    client: { auth } as unknown as SupabaseClient,
    auth,
    unsubscribe,
    emit: (s: Session | null) => listener?.(s ? 'SIGNED_IN' : 'SIGNED_OUT', s),
  }
}

let ctx!: AuthContextValue
function Capture() {
  ctx = useAuth()
  return (
    <>
      <p data-testid="status">{ctx.status}</p>
      <p data-testid="email">{ctx.email ?? ''}</p>
    </>
  )
}

function renderProvider(loadClient: () => Promise<SupabaseClient | null>) {
  return render(
    <AuthProvider loadClient={loadClient}>
      <Capture />
    </AuthProvider>,
  )
}

const expectStatus = (value: string) =>
  waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent(value))

describe('AuthProvider', () => {
  it('starts loading, then reports signedIn with the email when a session exists', async () => {
    const { client } = fakeClient(session)
    renderProvider(async () => client)
    expect(screen.getByTestId('status')).toHaveTextContent('loading')
    await expectStatus('signedIn')
    expect(screen.getByTestId('email')).toHaveTextContent('a@test.local')
  })

  it('reports signedOut when there is no session', async () => {
    const { client } = fakeClient(null)
    renderProvider(async () => client)
    await expectStatus('signedOut')
  })

  it('reports unconfigured when Supabase is not configured (local dev)', async () => {
    renderProvider(async () => null)
    await expectStatus('unconfigured')
    expect(await ctx.getToken()).toBeNull()
  })

  it('reports error when the Supabase config cannot be loaded', async () => {
    renderProvider(async () => {
      throw new Error('network down')
    })
    await expectStatus('error')
  })

  it('follows auth state changes', async () => {
    const { client, emit } = fakeClient(null)
    renderProvider(async () => client)
    await expectStatus('signedOut')
    act(() => emit(session))
    await expectStatus('signedIn')
    act(() => emit(null))
    await expectStatus('signedOut')
  })

  it('getToken returns the current access token', async () => {
    const { client } = fakeClient(session)
    renderProvider(async () => client)
    await expectStatus('signedIn')
    expect(await ctx.getToken()).toBe('tok-a')
  })

  it('signIn forwards credentials and returns the Supabase error message', async () => {
    const { client, auth } = fakeClient(null)
    auth.signInWithPassword.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } })
    renderProvider(async () => client)
    await expectStatus('signedOut')
    let result!: Awaited<ReturnType<AuthContextValue['signIn']>>
    await act(async () => {
      result = await ctx.signIn('a@test.local', 'pw')
    })
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@test.local', password: 'pw' })
    expect(result).toEqual({ error: 'Invalid login credentials', notice: null })
  })

  it('signUp without a session asks the user to confirm their email', async () => {
    const { client } = fakeClient(null)
    renderProvider(async () => client)
    await expectStatus('signedOut')
    let result!: Awaited<ReturnType<AuthContextValue['signUp']>>
    await act(async () => {
      result = await ctx.signUp('new@test.local', 'secret1')
    })
    expect(result.error).toBeNull()
    expect(result.notice).toMatch(/confirm/i)
  })

  it('signUp surfaces Supabase errors', async () => {
    const { client, auth } = fakeClient(null)
    auth.signUp.mockResolvedValueOnce({ data: { session: null }, error: { message: 'User already registered' } })
    renderProvider(async () => client)
    await expectStatus('signedOut')
    let result!: Awaited<ReturnType<AuthContextValue['signUp']>>
    await act(async () => {
      result = await ctx.signUp('a@test.local', 'secret1')
    })
    expect(result).toEqual({ error: 'User already registered', notice: null })
  })

  it('signInWithGoogle redirects back to the SPA base path', async () => {
    const { client, auth } = fakeClient(null)
    renderProvider(async () => client)
    await expectStatus('signedOut')
    await act(async () => {
      await ctx.signInWithGoogle()
    })
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/app/` },
    })
  })

  it('signOut signs out of Supabase', async () => {
    const { client, auth } = fakeClient(session)
    renderProvider(async () => client)
    await expectStatus('signedIn')
    await act(async () => {
      await ctx.signOut()
    })
    expect(auth.signOut).toHaveBeenCalled()
  })

  it('unsubscribes from auth changes on unmount', async () => {
    const { client, unsubscribe } = fakeClient(null)
    const { unmount } = renderProvider(async () => client)
    await expectStatus('signedOut')
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm --prefix web test -- src/lib/supabase/auth.test.tsx`
Expected: FAIL, cannot resolve `./auth`.

- [ ] **Step 3: Implement the client** — `web/src/lib/supabase/client.ts`

```ts
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
```

- [ ] **Step 4: Implement the provider** — `web/src/lib/supabase/auth.tsx`

```tsx
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getSupabase } from './client'

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'unconfigured' | 'error'

export interface AuthResult {
  error: string | null
  notice: string | null
}

export interface AuthContextValue {
  status: AuthStatus
  email: string | null
  getToken: () => Promise<string | null>
  signIn: (email: string, password: string) => Promise<AuthResult>
  signUp: (email: string, password: string) => Promise<AuthResult>
  signInWithGoogle: () => Promise<AuthResult>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

const NOT_CONFIGURED: AuthResult = { error: 'Sign-in is not configured.', notice: null }

export function AuthProvider({
  children,
  loadClient = getSupabase,
}: {
  children: ReactNode
  loadClient?: () => Promise<SupabaseClient | null>
}) {
  const [client, setClient] = useState<SupabaseClient | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    loadClient()
      .then(async (c) => {
        if (cancelled) return
        if (!c) {
          setStatus('unconfigured')
          return
        }
        setClient(c)
        const { data } = await c.auth.getSession()
        if (cancelled) return
        setSession(data.session)
        setStatus(data.session ? 'signedIn' : 'signedOut')
        const { data: sub } = c.auth.onAuthStateChange((_event, next) => {
          setSession(next)
          setStatus(next ? 'signedIn' : 'signedOut')
        })
        unsubscribe = () => sub.subscription.unsubscribe()
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [loadClient])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      email: session?.user.email ?? null,
      getToken: async () => {
        if (!client) return null
        const { data } = await client.auth.getSession()
        return data.session?.access_token ?? null
      },
      signIn: async (email, password) => {
        if (!client) return NOT_CONFIGURED
        const { error } = await client.auth.signInWithPassword({ email, password })
        return { error: error?.message ?? null, notice: null }
      },
      signUp: async (email, password) => {
        if (!client) return NOT_CONFIGURED
        const { data, error } = await client.auth.signUp({ email, password })
        if (error) return { error: error.message, notice: null }
        return {
          error: null,
          notice: data.session ? null : 'Check your email to confirm your account, then sign in.',
        }
      },
      signInWithGoogle: async () => {
        if (!client) return NOT_CONFIGURED
        const { error } = await client.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}` },
        })
        return { error: error?.message ?? null, notice: null }
      },
      signOut: async () => {
        await client?.auth.signOut()
      },
    }),
    [client, session, status],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
```

- [ ] **Step 5: Run to verify pass, then the full checks**

Run: `npm --prefix web test` -> Expected: all PASS.
Run: `npm --prefix web run lint && npm --prefix web run typecheck` -> Expected: exit 0. (If lint flags `ctx!` / render-time assignment in the test file, keep the pattern and add a one-line `// eslint-disable-next-line` for that exact rule only, noting it in the report.)

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "feat(web): runtime Supabase client and AuthProvider (email, Google, unconfigured mode)"
```

---

### Task 4: App shell, route guard, login page

**Files:**
- Create: `web/src/test/utils.tsx`, `web/src/app/ProtectedRoute.tsx`, `web/src/app/ProtectedRoute.test.tsx`, `web/src/app/Shell.tsx`, `web/src/app/Shell.test.tsx`, `web/src/app/PlaceholderPage.tsx`, `web/src/features/auth/LoginPage.tsx`, `web/src/features/auth/LoginPage.test.tsx`

**Interfaces:**
- Consumes: `AuthContext`, `AuthContextValue`, `useAuth` from `../lib/supabase/auth` (Task 3).
- Produces (`test/utils.tsx`): `authValue(overrides?: Partial<AuthContextValue>): AuthContextValue` (default signed-in `a@test.local`, token `token-a`, `vi.fn` actions); `renderAt(ui: ReactElement, opts?: { route?: string; auth?: AuthContextValue }): RenderResult` — wraps in `QueryClientProvider` (retry off), `AuthContext.Provider`, `MemoryRouter`.
- Produces: `ProtectedRoute()` (layout route: loading -> `role="status"` "Loading…"; error -> `role="alert"` "Can't reach the Somada server. Try again in a moment."; signedOut -> `<Navigate to="/login" replace />`; signedIn/unconfigured -> `<Outlet />`); `Shell()` (layout route: header with brand, `nav[aria-label="Main"]` with NavLinks Dashboard `/` (end), Insights `/insights`, Settings `/settings`; account area with email + "Sign out" only when `status === 'signedIn'`; `<main><Outlet/></main>`); `PlaceholderPage({ title, children })`; `LoginPage()`.

- [ ] **Step 1: Write test utilities** — `web/src/test/utils.tsx`

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../lib/supabase/auth'

export function authValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: 'signedIn',
    email: 'a@test.local',
    getToken: async () => 'token-a',
    signIn: vi.fn().mockResolvedValue({ error: null, notice: null }),
    signUp: vi.fn().mockResolvedValue({ error: null, notice: null }),
    signInWithGoogle: vi.fn().mockResolvedValue({ error: null, notice: null }),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

export function renderAt(
  ui: ReactElement,
  { route = '/', auth = authValue() }: { route?: string; auth?: AuthContextValue } = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}
```

- [ ] **Step 2: Write the failing tests**

`web/src/app/ProtectedRoute.test.tsx`:
```tsx
import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { authValue, renderAt } from '../test/utils'
import { ProtectedRoute } from './ProtectedRoute'

function renderGuarded(status: Parameters<typeof authValue>[0]) {
  return renderAt(
    <Routes>
      <Route path="/login" element={<p>login page</p>} />
      <Route element={<ProtectedRoute />}>
        <Route index element={<p>secret content</p>} />
      </Route>
    </Routes>,
    { auth: authValue(status) },
  )
}

describe('ProtectedRoute', () => {
  it('shows a loading status while the session is being checked', () => {
    renderGuarded({ status: 'loading' })
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(screen.queryByText('secret content')).not.toBeInTheDocument()
  })

  it('redirects signed-out visitors to /login', () => {
    renderGuarded({ status: 'signedOut', email: null })
    expect(screen.getByText('login page')).toBeInTheDocument()
    expect(screen.queryByText('secret content')).not.toBeInTheDocument()
  })

  it('renders the protected content when signed in', () => {
    renderGuarded({ status: 'signedIn' })
    expect(screen.getByText('secret content')).toBeInTheDocument()
  })

  it('lets visitors in when auth is not configured (local dev)', () => {
    renderGuarded({ status: 'unconfigured', email: null })
    expect(screen.getByText('secret content')).toBeInTheDocument()
  })

  it('shows an alert when the server cannot be reached', () => {
    renderGuarded({ status: 'error', email: null })
    expect(screen.getByRole('alert')).toHaveTextContent("Can't reach the Somada server")
    expect(screen.queryByText('secret content')).not.toBeInTheDocument()
  })
})
```

`web/src/app/Shell.test.tsx`:
```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { authValue, renderAt } from '../test/utils'
import { Shell } from './Shell'

function renderShell(auth = authValue()) {
  return renderAt(
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<p>page body</p>} />
      </Route>
    </Routes>,
    { auth },
  )
}

describe('Shell', () => {
  it('has persistent navigation to Dashboard, Insights and Settings', () => {
    renderShell()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(nav).toContainElement(screen.getByRole('link', { name: 'Dashboard' }))
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Insights' })).toHaveAttribute('href', '/insights')
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
    expect(screen.getByText('page body')).toBeInTheDocument()
  })

  it('shows the account email and signs out on request', async () => {
    const signOut = vi.fn().mockResolvedValue(undefined)
    renderShell(authValue({ signOut }))
    expect(screen.getByText('a@test.local')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('hides the account area when auth is not configured', () => {
    renderShell(authValue({ status: 'unconfigured', email: null }))
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })
})
```

`web/src/features/auth/LoginPage.test.tsx`:
```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { authValue, renderAt } from '../../test/utils'
import { LoginPage } from './LoginPage'

function renderLogin(auth = authValue({ status: 'signedOut', email: null })) {
  return renderAt(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<p>home</p>} />
    </Routes>,
    { route: '/login', auth },
  )
}

async function fillCredentials() {
  await userEvent.type(screen.getByLabelText('Email'), 'a@test.local')
  await userEvent.type(screen.getByLabelText('Password'), 'secret1')
}

describe('LoginPage', () => {
  it('signs in with the typed credentials', async () => {
    const signIn = vi.fn().mockResolvedValue({ error: null, notice: null })
    renderLogin(authValue({ status: 'signedOut', email: null, signIn }))
    await fillCredentials()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(signIn).toHaveBeenCalledWith('a@test.local', 'secret1')
  })

  it('shows the error message when sign-in fails', async () => {
    const signIn = vi.fn().mockResolvedValue({ error: 'Invalid login credentials', notice: null })
    renderLogin(authValue({ status: 'signedOut', email: null, signIn }))
    await fillCredentials()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials')
  })

  it('creates an account and shows the confirmation notice', async () => {
    const signUp = vi
      .fn()
      .mockResolvedValue({ error: null, notice: 'Check your email to confirm your account, then sign in.' })
    renderLogin(authValue({ status: 'signedOut', email: null, signUp }))
    await fillCredentials()
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(signUp).toHaveBeenCalledWith('a@test.local', 'secret1')
    expect(await screen.findByRole('status')).toHaveTextContent('Check your email')
  })

  it('offers Google sign-in', async () => {
    const signInWithGoogle = vi.fn().mockResolvedValue({ error: null, notice: null })
    renderLogin(authValue({ status: 'signedOut', email: null, signInWithGoogle }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))
    expect(signInWithGoogle).toHaveBeenCalledTimes(1)
  })

  it('redirects to the dashboard once signed in', () => {
    renderLogin(authValue({ status: 'signedIn' }))
    expect(screen.getByText('home')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npm --prefix web test -- src/app src/features/auth`
Expected: FAIL, cannot resolve `./ProtectedRoute`, `./Shell`, `./LoginPage`.

- [ ] **Step 4: Implement**

`web/src/app/ProtectedRoute.tsx`:
```tsx
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/supabase/auth'

export function ProtectedRoute() {
  const { status } = useAuth()
  if (status === 'loading') return <p role="status">Loading…</p>
  if (status === 'error') {
    return <p role="alert">Can't reach the Somada server. Try again in a moment.</p>
  }
  if (status === 'signedOut') return <Navigate to="/login" replace />
  return <Outlet />
}
```

`web/src/app/Shell.tsx`:
```tsx
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/supabase/auth'

export function Shell() {
  const { status, email, signOut } = useAuth()
  return (
    <div className="shell">
      <header className="shell-header">
        <span className="brand">Somada</span>
        <nav aria-label="Main">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/insights">Insights</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        {status === 'signedIn' && (
          <div className="account">
            <span>{email}</span>
            <button type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        )}
      </header>
      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  )
}
```

`web/src/app/PlaceholderPage.tsx`:
```tsx
import type { ReactNode } from 'react'

export function PlaceholderPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h1>{title}</h1>
      <p>{children}</p>
      <p>
        <a href="/">Open the classic app</a>
      </p>
    </section>
  )
}
```

`web/src/features/auth/LoginPage.tsx`:
```tsx
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth, type AuthResult } from '../../lib/supabase/auth'

type Message = { kind: 'error' | 'notice'; text: string }

export function LoginPage() {
  const { status, signIn, signUp, signInWithGoogle } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<Message | null>(null)
  const [busy, setBusy] = useState(false)

  if (status === 'signedIn' || status === 'unconfigured') return <Navigate to="/" replace />

  async function run(action: () => Promise<AuthResult>) {
    setBusy(true)
    setMessage(null)
    const result = await action()
    setBusy(false)
    if (result.error) setMessage({ kind: 'error', text: result.error })
    else if (result.notice) setMessage({ kind: 'notice', text: result.notice })
  }

  return (
    <form
      className="login"
      onSubmit={(e) => {
        e.preventDefault()
        void run(() => signIn(email, password))
      }}
    >
      <h1>Sign in to Somada</h1>
      <label>
        Email
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          required
          minLength={6}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {message && <p role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
      <div className="actions">
        <button type="submit" disabled={busy}>
          Sign in
        </button>
        <button type="button" disabled={busy} onClick={() => void run(() => signUp(email, password))}>
          Create account
        </button>
        <button type="button" disabled={busy} onClick={() => void run(() => signInWithGoogle())}>
          Continue with Google
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 5: Run to verify pass, then the full checks**

Run: `npm --prefix web test` -> Expected: all PASS.
Run: `npm --prefix web run lint && npm --prefix web run typecheck` -> Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "feat(web): app shell, protected routes and login page"
```

---

### Task 5: Dashboard placeholder, route table, and app entry

**Files:**
- Create: `web/src/features/dashboard/DashboardPage.tsx`, `web/src/features/dashboard/DashboardPage.test.tsx`, `web/src/app/AppRoutes.tsx`, `web/src/app/AppRoutes.test.tsx`, `web/src/styles.css`
- Modify: `web/src/main.tsx` (replace the Task 1 placeholder)

**Interfaces:**
- Consumes: `useAuth`, `getHealth`, `ApiError`, `HealthData`, `ProtectedRoute`, `Shell`, `PlaceholderPage`, `LoginPage`, test helpers `renderAt`, `authValue`, `stubFetch`, `healthFixture`.
- Produces: `DashboardPage()` — TanStack Query key `['health', email]`; states: pending -> `role="status"` "Loading your data…"; error -> `role="alert"` with the error message; `null` data -> heading "No health data yet" plus a link to the classic app; data -> `<h1>Dashboard</h1>`, `"{summary.total_days} days of data"`, and when `data.is_demo` a `role="status"` banner "You're viewing sample data" with a link `Upload your own data` to `/`. `AppRoutes()` — routes: `/login`, then under `ProtectedRoute` > `Shell`: index `DashboardPage`, `insights`, `settings` placeholders, `*` -> `<Navigate to="/" replace />`.

- [ ] **Step 1: Write the failing tests**

`web/src/features/dashboard/DashboardPage.test.tsx`:
```tsx
import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../../test/fetch'
import { healthFixture } from '../../test/fixtures'
import { authValue, renderAt } from '../../test/utils'
import { DashboardPage } from './DashboardPage'

afterEach(() => {
  vi.unstubAllGlobals()
})

function ownData() {
  const data = healthFixture()
  data.summary.total_days = 120
  return data
}

describe('DashboardPage', () => {
  it('shows a loading status, then the size of the user\'s own dataset', async () => {
    stubFetch(200, ownData())
    renderAt(<DashboardPage />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading your data')
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByText('120 days of data')).toBeInTheDocument()
    expect(screen.queryByText(/sample data/i)).not.toBeInTheDocument()
  })

  it('requests health data with the signed-in user\'s token', async () => {
    const calls = stubFetch(200, ownData())
    renderAt(<DashboardPage />, { auth: authValue({ getToken: async () => 'token-b' }) })
    await screen.findByRole('heading', { name: 'Dashboard' })
    expect(calls[0].url).toBe('/api/health')
    expect(calls[0].headers.get('Authorization')).toBe('Bearer token-b')
  })

  it('labels the shared demo dataset as sample data and links to the classic upload', async () => {
    stubFetch(200, { ...ownData(), is_demo: true })
    renderAt(<DashboardPage />)
    expect(await screen.findByText(/You're viewing sample data/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Upload your own data' })).toHaveAttribute('href', '/')
  })

  it('tells new users there is no data yet when the server has none', async () => {
    stubFetch(200, { error: 'No health data found.' })
    renderAt(<DashboardPage />)
    expect(await screen.findByRole('heading', { name: 'No health data yet' })).toBeInTheDocument()
  })

  it('shows the server error message when the request fails', async () => {
    stubFetch(401, { error: 'Sign in required.' })
    renderAt(<DashboardPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in required.')
  })
})
```

`web/src/app/AppRoutes.test.tsx`:
```tsx
import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fetch'
import { healthFixture } from '../test/fixtures'
import { authValue, renderAt } from '../test/utils'
import { AppRoutes } from './AppRoutes'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AppRoutes', () => {
  it('sends signed-out visitors to the login page', () => {
    renderAt(<AppRoutes />, { auth: authValue({ status: 'signedOut', email: null }) })
    expect(screen.getByRole('heading', { name: 'Sign in to Somada' })).toBeInTheDocument()
  })

  it('renders the dashboard inside the shell for signed-in users', async () => {
    stubFetch(200, healthFixture())
    renderAt(<AppRoutes />)
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })

  it('serves the Insights and Settings placeholders', () => {
    renderAt(<AppRoutes />, { route: '/insights' })
    expect(screen.getByRole('heading', { name: 'Insights' })).toBeInTheDocument()
  })

  it('redirects unknown paths to the dashboard', async () => {
    stubFetch(200, healthFixture())
    renderAt(<AppRoutes />, { route: '/nope' })
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm --prefix web test -- src/features/dashboard src/app/AppRoutes.test.tsx`
Expected: FAIL, cannot resolve `./DashboardPage` and `./AppRoutes`.

- [ ] **Step 3: Implement**

`web/src/features/dashboard/DashboardPage.tsx`:
```tsx
import { useQuery } from '@tanstack/react-query'
import { getHealth } from '../../lib/api/client'
import { useAuth } from '../../lib/supabase/auth'

export function DashboardPage() {
  const { email, getToken } = useAuth()
  const { data, isPending, error } = useQuery({
    queryKey: ['health', email],
    queryFn: () => getHealth(getToken),
  })

  if (isPending) return <p role="status">Loading your data…</p>
  if (error) return <p role="alert">{error.message}</p>

  if (data === null) {
    return (
      <section>
        <h1>No health data yet</h1>
        <p>Uploading your Apple Health export is coming to the new app. For now, use the classic app.</p>
        <p>
          <a href="/">Open the classic app</a>
        </p>
      </section>
    )
  }

  return (
    <section>
      <h1>Dashboard</h1>
      {data.is_demo && (
        <p role="status" className="demo-banner">
          You're viewing sample data. <a href="/">Upload your own data</a>
        </p>
      )}
      <p>{data.summary.total_days} days of data</p>
    </section>
  )
}
```

`web/src/app/AppRoutes.tsx`:
```tsx
import { Navigate, Route, Routes } from 'react-router-dom'
import { LoginPage } from '../features/auth/LoginPage'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { PlaceholderPage } from './PlaceholderPage'
import { ProtectedRoute } from './ProtectedRoute'
import { Shell } from './Shell'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Shell />}>
          <Route index element={<DashboardPage />} />
          <Route
            path="insights"
            element={
              <PlaceholderPage title="Insights">
                Chat with your health data is coming to the new app.
              </PlaceholderPage>
            }
          />
          <Route
            path="settings"
            element={
              <PlaceholderPage title="Settings">
                Account and AI settings are coming to the new app.
              </PlaceholderPage>
            }
          />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
```

`web/src/main.tsx` (replace the placeholder):
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AppRoutes } from './app/AppRoutes'
import { AuthProvider } from './lib/supabase/auth'
import './styles.css'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/app">
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
```

`web/src/styles.css`:
```css
:root {
  --bg: #ffffff;
  --fg: #16181d;
  --muted: #5b6270;
  --line: #e2e5ea;
  --accent: #0b6bcb;
  --warn-bg: #fff6df;
  --warn-fg: #7a5200;
  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #101216;
    --fg: #eceef2;
    --muted: #9aa3b2;
    --line: #272b33;
    --accent: #6cb0ff;
    --warn-bg: #3a2f10;
    --warn-fg: #ffd98a;
  }
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif;
}

a {
  color: var(--accent);
}

.shell-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 24px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
}

.brand {
  font-weight: 700;
}

.shell-header nav {
  display: flex;
  gap: 16px;
  flex: 1;
}

.shell-header nav a {
  color: var(--muted);
  text-decoration: none;
}

.shell-header nav a.active {
  color: var(--fg);
  font-weight: 600;
}

.account {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--muted);
}

.shell-main {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 16px;
}

.login {
  display: grid;
  gap: 12px;
  max-width: 360px;
  margin: 10vh auto 0;
  padding: 0 16px;
}

.login label {
  display: grid;
  gap: 4px;
}

.login input {
  padding: 8px;
  font: inherit;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

button {
  padding: 8px 14px;
  font: inherit;
  cursor: pointer;
}

.demo-banner {
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--warn-bg);
  color: var(--warn-fg);
}
```

- [ ] **Step 4: Run all checks**

Run: `npm --prefix web test` -> Expected: all PASS.
Run: `npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web run build` -> Expected: exit 0, `web/dist/index.html` present.

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "feat(web): dashboard placeholder with demo banner, route table and app entry"
```

---

### Task 6: Site assembly for Vercel

**Files:**
- Create: `scripts/build-site.mjs`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `web/dist/` (from `npm --prefix web run build`), root `index.html`, root `icon.png`.
- Produces: `public/` with the legacy page and icon at its root and the built SPA at `public/app/`; Vercel config that builds it and rewrites correctly.

- [ ] **Step 1: Write the assembly script** — `scripts/build-site.mjs`

```js
// Assemble the static site for Vercel: legacy page at /, new SPA at /app/.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public')
const webDist = join(root, 'web', 'dist')

if (!existsSync(join(webDist, 'index.html'))) {
  console.error('web/dist/index.html not found. Run `npm --prefix web run build` first.')
  process.exit(1)
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(join(root, 'index.html'), join(out, 'index.html'))
cpSync(join(root, 'icon.png'), join(out, 'icon.png'))
cpSync(webDist, join(out, 'app'), { recursive: true })
console.log('Assembled public/ (legacy at /, new app at /app/)')
```

- [ ] **Step 2: Verify it fails without a build, then passes with one**

```bash
rm -rf web/dist public
node scripts/build-site.mjs; echo "exit=$?"
```
Expected: the "not found" message and `exit=1`.

```bash
npm --prefix web run build && node scripts/build-site.mjs; echo "exit=$?"
ls public public/app public/app/assets
```
Expected: `exit=0`; `public/index.html`, `public/icon.png`, `public/app/index.html`, and JS/CSS files under `public/app/assets/`. Confirm `public/index.html` is byte-identical to the root `index.html` (`cmp index.html public/index.html`).

- [ ] **Step 3: Update `vercel.json`** (replace the whole file)

```json
{
  "version": 2,
  "buildCommand": "npm --prefix web ci && npm --prefix web run build && node scripts/build-site.mjs",
  "outputDirectory": "public",
  "rewrites": [
    { "source": "/app/(.*)", "destination": "/app/index.html" },
    { "source": "/((?!api/|app/).*)", "destination": "/index.html" }
  ]
}
```
Static files (e.g. `/app/assets/*.js`) are served before rewrites apply, so only non-file paths such as `/app/insights` fall back to the SPA. The second rule keeps the old behavior for the legacy page.

- [ ] **Step 4: Verify JSON validity**

Run: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('ok')"` -> Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-site.mjs vercel.json
git commit -m "build: assemble legacy page at / and new app at /app/ for Vercel"
```

---

### Task 7: CI job and docs

**Files:**
- Modify: `.github/workflows/tests.yml` (append a job), `README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-03-somada-modernization-design.md`

- [ ] **Step 1: Add the `web` job** — append to the `jobs:` map in `.github/workflows/tests.yml` (same indentation as `api:`):

```yaml
  web:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    defaults:
      run:
        working-directory: web
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
          cache-dependency-path: web/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

- [ ] **Step 2: Validate the workflow YAML**

Run: `python -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/tests.yml')); print(sorted(d['jobs']))"` -> Expected: `['api', 'web']`. (If PyYAML is unavailable, re-read the file and check indentation instead.)

- [ ] **Step 3: Document it.** Preserve each file's existing line endings (check before editing).

`README.md`: add a new section before `## Features`:

```markdown
## New app (work in progress)

A rebuilt frontend lives in `web/` (Vite + React + TypeScript) and is served at `/app/` next to the classic page, which stays at `/` until the new app reaches parity. Today it has sign-in (email/password and Google), an app shell, and a dashboard placeholder; charts, upload and chat are still in the classic app.

Develop it with two terminals:

```bash
vercel dev                 # serves the Python API on :3000 (needs SUPABASE_* env vars)
npm --prefix web install
npm --prefix web run dev   # http://localhost:5173/app/ (proxies /api to :3000)
```

Checks: `npm --prefix web run lint`, `typecheck`, `test`, `build`. The Vercel build assembles both apps with `scripts/build-site.mjs`.

For Google sign-in on the new app, add `https://<your-domain>/app/` (and any preview URLs) to the Redirect URLs in Supabase Authentication settings.
```

`CLAUDE.md`: (a) in the File Structure code block add lines `|- web/ # New frontend (Vite + React + TS), served at /app/` and `|- scripts/ # build-site.mjs, make_demo_seed.py` (keep the existing `supabase/` line); (b) under "Frontend Notes" append: "The new app in `web/` fetches its Supabase config at runtime from `/api/supabase_config` and sends the user's JWT as `Authorization: Bearer` on `/api/*` calls. `AuthStatus` is `unconfigured` in local dev (no Supabase env), which skips login. `index.html` (legacy) is still the production app at `/`."

Spec: under "Open items" add the bullet: "Deviation: during rollout steps 1-4 the new app is served at `/app/` and the legacy page stays at `/`; the swap (new app at `/`, legacy removed) happens at cutover, instead of putting the legacy page at `/legacy`. Rationale: existing users and bookmarks keep working with zero redirects."

- [ ] **Step 4: Run everything once more**

Run: `python -m pytest -q && npm --prefix web test && npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web run build`
Expected: all pass (54 Python tests plus the web tests).

- [ ] **Step 5: Commit and open the PR**

```bash
git add .github README.md CLAUDE.md docs
git commit -m "ci: add web job; docs for the new app"
git push -u origin feat/web-scaffold
gh pr create --base master --title "New frontend scaffold: Vite + React + TS app at /app/ with auth and shell (Step 1)" --body "Step 1 of the modernization (docs/superpowers/plans/2026-10-03-step1-web-scaffold.md). Adds web/ served at /app/ beside the untouched legacy page. See the plan's Task 8 for the preview-deploy checks, including the Supabase redirect-URL setting needed for Google sign-in."
```
(Pushing and opening the PR require the user's go-ahead in the session running this plan.)

---

### Task 8: Preview deploy and manual verification (user)

Manual; needs Vercel and Supabase dashboards. Do before merging.

- [ ] **Step 1: Confirm the two decisions flagged in this plan:** (a) new app at `/app/` with the legacy page staying at `/` (vs. the spec's original `/legacy` idea); (b) Google sign-in included for parity with the classic app.
- [ ] **Step 2: Supabase redirect URLs.** Supabase dashboard -> Authentication -> URL Configuration: add `https://somada.vercel.app/app/` and the PR's preview URL pattern (e.g. `https://*-<team>.vercel.app/app/**`) to the Redirect URLs.
- [ ] **Step 3: Check the Vercel preview of the PR** (build must succeed; if Vercel fails to detect the Python functions after the `buildCommand` change, fix `vercel.json` before anything else):
  - `/` still shows the classic app and `/api/health` still returns 401 when signed out.
  - `/app/` redirects to `/app/login`; signing in with email works and lands on the dashboard; the dashboard shows "N days of data" and, for an account without its own upload, the "sample data" banner.
  - Reload on `/app/insights` works (no 404); Sign out returns to the login page.
  - Google sign-in returns to `/app/` signed in (only if the redirect URL was added).
- [ ] **Step 4: Merge** once the above is green and Step 0's production cutover (plan 1, Task 9) is done or its preview Supabase is the scratch project.

---

## Self-Review

**Spec coverage (rollout step 2 and "New frontend" section):** Vite/React/TS strict, React Router, TanStack Query, Vitest, Supabase from npm -> Tasks 1-3; auth + shell + navigation (Dashboard/Insights/Settings) -> Tasks 3-5; typed `/api/*` client with JWT -> Task 2; "preview URL" + deploy config -> Tasks 6, 8; CI lint/typecheck/tests -> Task 7. Deliberately deferred: charting library, Playwright, parsing/onboarding/chat/events/settings content (their own plans). The demo-data banner from Step 0's server marker is exercised end to end (Task 5).

**Placeholder scan:** no TBD/TODO; every code step has complete code; the only contingencies are explicit "report instead of guessing" notes for dependency/tooling drift (Task 1 Steps 3 and 6, Task 3 Step 5).

**Type consistency:** `AuthContextValue`, `AuthStatus`, `AuthResult`, `TokenProvider`, `getHealth`, `ApiError`, `stubFetch`, `healthFixture`, `authValue`, `renderAt` are named identically across the interfaces blocks, tests and implementations. Auth test status strings (`loading`, `signedOut`, `signedIn`, `unconfigured`, `error`) match the union. Button labels used in tests ("Sign in", "Create account", "Continue with Google", "Sign out") match the components.

**Known risks:** (1) Vercel's handling of a Node `buildCommand` alongside zero-config Python functions is verified only on the preview deploy (Task 8); (2) dependency versions float to latest at install time, so the lockfile is the source of truth and small API drift (React Router, Vitest, ESLint plugin) is possible; (3) Google sign-in needs the Supabase redirect-URL setting that only you can change.
