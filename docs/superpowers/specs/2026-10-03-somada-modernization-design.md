# Somada Modernization — Design

Date: 2026-10-03
Status: Draft for review

## Goals

1. Close the privacy hole: today every user shares one publicly readable row.
2. Replace the single 2,325-line `index.html` with a typed, tested, componentized frontend.
3. Address the three known user complaints: generic AI chat, confusing navigation, painful onboarding.
4. Keep the live app working for existing users throughout (staged migration, no big-bang cutover).

## Current state (as found in the repo)

- Frontend: one `index.html`, vanilla JS, Chart.js and Supabase loaded from CDNs. No build step, no TypeScript, no tests.
- Backend: Python Vercel functions in `api/` (`chat.py`, `chat_core.py` at 634 lines, `health.py`, `config.py`, `supabase_config.py`), plus local-only `server.py` and `parse_health.py`.
- Data: one Supabase table `health_data(id integer PK default 1, data jsonb, updated_at)`. The frontend upserts `{ id: 1 }` (`index.html:1902`); `api/chat_core.py` reads `id=eq.1`. The read policy is `USING (true)`.
- AI: Gemini (Vertex) and Claude (`claude-sonnet-4-6`), server keys or BYOK. Health context is already injected into the system prompt.
- `LIFE_EVENTS` is duplicated in `index.html` and `parse_health.py`.

Note: the live schema may differ from the README. It must be verified before the Step 0 migration is finalized.

## Target architecture

```text
Somada/
|- web/                 # NEW: Vite + React + TypeScript (replaces index.html)
|- api/                 # Python functions, kept and authenticated
|- supabase/migrations/ # NEW: schema as versioned SQL
|- index.html           # legacy; live until cutover, then deleted
```

## Step 0 — Privacy fix (ships first)

- Migration adds `user_id uuid references auth.users`, makes it the primary key, and drops `id=1`.
- RLS: select/insert/update only where `user_id = auth.uid()`. Remove `allow_public_read`.
- API: shared `api/auth.py` verifies the `Authorization: Bearer <jwt>` header against Supabase and returns `user_id`. `chat.py` and `health.py` load only that user's row. Missing or invalid token returns 401. No `limit=1` fallback.
- Legacy `index.html` gets a minimal patch: send the token on API calls, upsert with `user_id`.
- Existing row: either assign to the owner's account or wipe and have users re-upload. Decided after the live schema check.
- BYOK keys remain browser-only; the server never stores or logs them.

## New frontend (`web/`)

Stack: Vite, React, TypeScript (strict), React Router, TanStack Query, a charting library behind a thin wrapper (Recharts or Chart.js), Vitest, one Playwright smoke test. Supabase JS from npm.

```text
web/src/
|- lib/health/   # parse worker, types (HealthData, DailyEntry), summary calc
|- lib/api/      # typed /api/* client (attaches JWT)
|- lib/supabase/ # client, auth hook
|- features/
|  |- onboarding/  # guided upload, sample-data preview
|  |- dashboard/   # metric views, time windows, event annotations
|  |- insights/    # chat, provider picker, BYOK
|  |- settings/
|- app/            # shell, routing, navigation
```

Decisions:

- **Parsing** runs in a streaming Web Worker, unit-tested against a small fixture export. The `HealthData` JSON shape is unchanged so the API and existing data stay compatible.
- **Life events** become user data stored in the same row and editable in the UI, removing the duplicated constant and the "edit code, re-upload" workflow.
- **Navigation**: persistent shell (Dashboard, Insights, Settings) with plain-language metric explainers (e.g. "What is HRV?").
- **Onboarding**: step-by-step export guide, parse progress, and a first-chart preview before saving.
- **Chat grounding**: the chat sends the active date range and selected events as context to `/api/chat`.
- **Deploy**: Vercel builds `web/` to `dist`; `vercel.json` routes `/api/*` to Python and the rest to the SPA, with the legacy page at `/legacy` until cutover.

## API and AI layer

- `config.py` and `supabase_config.py` remain public (no sensitive data).
- `server.py` and `parse_health.py` are removed at cutover; local dev uses `vercel dev`.
- Per-user rate limiting on `/api/chat` to protect shared server keys.
- Model IDs come from env vars with no hard-coded defaults, so upgrades are config changes. Current defaults (`claude-sonnet-4-6`, Gemini 2.5 Flash) are checked against the latest model IDs during implementation.
- `build_system_prompt` is covered by tests: fixed fixture in, prompt contains the 30-day summary, events and selected date range.
- Agentic retrieval (Option B in `design/Context.md`) is out of scope; the API shape leaves room for it.

## Testing and CI

- Vitest: parser, summary math, API client.
- Pytest: JWT auth, prompt building.
- Playwright: sign in with a test account, upload a fixture, see charts.
- GitHub Actions: lint, typecheck, tests on every PR.

## Rollout (one PR per step)

1. Step 0: migration, API auth, legacy patch. Verify with a second test account.
2. Scaffold `web/` with auth and shell on a preview URL.
3. Port parsing and onboarding.
4. Port the dashboard.
5. Port insights with grounded chat.
6. Cutover: root serves `web/`; delete `index.html`, `server.py`, `parse_health.py`; update README and CLAUDE.md.

## Out of scope

Physician PDF export and share links (natural follow-up once data is per-user), agentic retrieval, relational schema redesign, porting the API to TypeScript.

## Open items

- Live Supabase schema and row contents (blocks the Step 0 migration decision).
- Charting library choice (Recharts vs Chart.js wrapper), to settle in the implementation plan.
- Deviation: the plan keeps `id` as the primary key (identity sequence) with `user_id` as a unique column rather than making `user_id` the primary key, so the demo row (null user_id) and the legacy row can coexist and rollback works.
