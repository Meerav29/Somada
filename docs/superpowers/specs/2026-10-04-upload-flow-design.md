# Apple Health Upload Flow (new app) — Design

Date: 2026-10-04
Status: Draft for review
Parent spec: `2026-10-03-somada-modernization-design.md` (rollout step 3: "Port parsing and onboarding")

## Goal

Let a signed-in user take their Apple Health export (`export.zip` or `export.xml`) to a saved, populated dashboard in the new app (`/app/`), faster and with fewer failures than the classic upload, without their raw health records leaving the browser.

## Shared understanding

Settled by the user or by the parent spec:

- Parsing moves into the new `web/` app, runs in a Web Worker, is streamed, and is unit-tested against a small fixture. The saved `HealthData` shape does not change, so the API and existing data stay compatible.
- Onboarding gets a step-by-step export guide, visible progress, and a first-chart preview before saving, so users get a payoff earlier.
- The primary complaint being fixed is onboarding friction: the export is technical and multi-step, and nothing rewards the user until the dashboard loads.
- Users upload **from a computer, after moving the ZIP off the iPhone**. The parser must not preclude a later phone-first path.
- The new flow accepts **both `export.zip` and `export.xml`**.
- A new upload starts with **no life events**, and a re-upload **keeps the user's existing events**.
- After parsing, the user sees a **preview, then explicitly saves**.

Assumptions (stated so they can be corrected):

- Success means a new user with a real export reaches a populated dashboard with fewer failures, and nothing is stored until they press Save.
- Real exports range from hundreds of MB to several GB and must not freeze or crash the tab.
- Output for the same input must match the classic parser (same `daily` and `summary`), apart from the improvements listed under "Intentional differences".

## What exists today (classic upload, `index.html`)

- `parseHealthXML(file)` reads the whole file with `file.text()` (hard limit 600 MB) and regex-scans it on the main thread, yielding every 5000 records. A 600 MB file becomes a ~1.2 GB string.
- The user must unzip the export and pick `export.xml`; a ZIP is rejected.
- Records older than 18 months (`DATA_RETENTION_MONTHS`) are dropped after aggregation.
- `events` comes from `localStorage` or falls back to hard-coded semester dates belonging to the app's author, so every user gets them.
- The file name is interpolated into `innerHTML`.
- Save is `supabase.from('health_data').upsert({ user_id, data }, { onConflict: 'user_id' })`.
- The summary logic is `computeSummaryStats` (covered by `tests/js/summary_stats.test.mjs`).

## Architecture

### 1. Parser and worker (`web/src/lib/health/`)

No UI in this layer.

- **`metrics.ts`** — the metric map and the set of "asleep" sleep values, copied verbatim from the classic parser. Values for `respiratory_rate` and `walking_hr` (never saved by the classic parser) are not accumulated, but such a record still creates its day entry, exactly as in the classic parser, so `total_days` matches.
- **`parseExport(chunks, options)`** — pure core. Input: `AsyncIterable<Uint8Array>`. Output: `{ daily, summary, stats }` where `stats` = `{ recordsSeen, recordsKept, firstDate, lastDate, bytesRead, maxCarryBytes }`. Options: `onProgress`, `now` (injectable for tests), `retentionMonths` (default 18).
  - Decodes UTF-8 in streaming mode, scans for `<Record …>` tags, and carries a partial tag over to the next chunk.
  - The tag tokenizer respects quoted attribute values (the classic `[^>]*?` regex breaks on a `>` inside a value).
  - Keeps one small accumulator per day (sums, counts, min/max) instead of value arrays, so memory is O(days), not O(records).
  - Skips records older than the retention cutoff while parsing (same result as filtering afterwards).
  - Date key, sleep-duration arithmetic, rounding and averaging are identical to the classic parser.
  - Guard: if a `<Record` start has no closing `>` within ~1 MB of carry, abort with `corrupt-file`.
- **`summary.ts`** — `computeSummaryStats` ported unchanged in behaviour (null-safe min/max).
- **`fileToChunks(file)`** — `.xml` -> `file.stream()`. `.zip` -> streaming unzip of the first `.xml` entry whose name does not contain "cda" and is not macOS resource-fork junk (`__MACOSX/` or a dot-prefixed basename such as `._export.xml`). This finds `export.xml` and its localized variants in a single pass; "largest" was dropped because entry sizes are not known up front in a streamed ZIP. The first 64 KB of the chosen entry must contain `<HealthData`, otherwise `not-health-export`. Progress is bytes of the *file* consumed over `file.size`.
- **`parse.worker.ts`** — receives `{ file }`; posts throttled (~10/s) `progress` messages (`fraction`, `recordsSeen`, `label`), then one `done` (result) or one `error` (`code`, `message`).
- **`useHealthUpload()`** — React hook owning the worker. States: `idle | reading | parsed | saving | saved | error`. `cancel()` terminates the worker; the worker is also terminated on unmount. A worker factory is injectable for tests.

Unzip library: `fflate` (streaming `Unzip`). The first plan task is a throwaway spike proving it handles ZIP64 entries and ZIP files that store sizes in a trailing data descriptor, using a generated fixture.

### 2. Screens (`web/src/features/upload/`)

Route `/app/upload`; one page that moves through states.

1. **Guide + drop zone.** Checklist: Health app -> profile picture -> *Export All Health Data* -> wait (can take minutes) -> move the ZIP to this computer -> drop it here. The drop zone accepts `.zip` or `.xml` by click, drag, or keyboard, with a line stating the file is read in the browser and nothing is sent until Save. Wrong type and empty files are rejected immediately.
2. **Reading.** `progressbar` by bytes read, records seen, elapsed time, **Cancel**. Polite live-region updates.
3. **Preview (nothing saved).** Cards: days found, date range, average steps, sleep, resting HR, HRV; two inline-SVG sparklines (steps, sleep). Missing metrics are named ("No sleep data found in this export"). If the user already has their own data: "This replaces your current data (N days, through DATE). Your life events are kept." (N and DATE come from the dashboard's existing `['health', email]` query, which knows own-vs-demo via `is_demo`.) Buttons: **Save to my account**, **Choose a different file**.
4. **Saved.** Confirmation + **Go to dashboard**; the cached health query is updated.
5. **Errors**, each with a specific message and a next action: `wrong-file-type`, `empty-file`, `zip-missing-export`, `not-health-export`, `corrupt-file`, `no-usable-records`, `worker-failed` (including out of memory), `save-failed` (with **Retry**), `session-expired`, `not-configured`.

Entry points: the dashboard empty state and the sample-data banner link to `/app/upload` (today they link to the classic page); a new **Upload** link in the shell nav. Layout is a single column with 16 px gutters; labelled file input; `progressbar` role; `alert` for errors. Styling uses the existing tokens in `styles.css`; a visual redesign is out of scope.

### 3. Saving and re-upload (`web/src/lib/health/repository.ts`)

- Writes go from the browser to Supabase under the existing RLS (no Python API change; payload is small, ~18 months of daily numbers).
- `loadOwnEvents()` reads the signed-in user's own row (`user_id = current user`) and returns its `events` or `[]`. It never reads the demo row, so the demo's sample event cannot leak into a real account.
- `saveOwnHealth(parsed)` reads current events at save time, then upserts `{ user_id, data: { daily, summary, events, generated_at }, updated_at }` with `onConflict: 'user_id'` (this also fixes the missing `updated_at` refresh deferred from Step 0).
- **Replace, not merge.** `daily` and `summary` are fully replaced; `events` carry over. Last write wins across tabs.
- Only aggregated daily numbers are stored; raw records never leave the browser.
- After save the `['health', email]` query is updated; the classic app already syncs its demo banner from the server.
- A failed save keeps the parsed result in memory so **Retry** does not re-parse. An expired session shows `session-expired` (the parsed result is lost when sign-in remounts the page). In local dev (Supabase not configured) **Save** is disabled with an explanation (`not-configured`).
- Not in scope: a database check on the stored JSON shape (a user can only affect their own row).

### 4. Edge cases, performance, security

- Memory is bounded by the current chunk, the carry-over, and per-day totals. Progress is throttled so the UI stays responsive. No time estimate is promised; the bytes progress bar is the signal.
- Cancel / choose another file / leaving the page terminates the worker; a second file dropped mid-parse is ignored.
- The parse makes no network calls (asserted by a test). XML is never passed to a DOM or XML parser. All UI text is rendered through React (no `innerHTML`), which removes the classic file-name injection. Nothing is logged or sent to analytics.

### 5. Testing and delivery

- **Fixtures:** a small hand-written `export.xml` covering every collected metric, sleep stages, tags split across chunks, and a `>` inside an attribute value. ZIP variants are built inside tests: normal folder, localized name, no `export.xml`, non-health XML.
- **Parity:** a test extracts the classic `parseHealthXML` from `index.html` (without editing that file, as `tests/js/summary_stats.test.mjs` does for the summary code) and asserts identical `daily` and `summary` on the same fixture with `now` pinned.
- **Chunk-boundary:** the same fixture parsed in chunks of 1, 7, 64 bytes and whole must give identical results.
- **Memory bound:** `maxCarryBytes` stays small over a long generated stream.
- **Hook** (fake worker): state machine, cancel, error mapping. **Repository** (fake Supabase client): events carried over, demo row never read, upsert shape and `updated_at`. **Screens** (Testing Library): every state, validation, replace notice, save success / retry / failure, entry points.
- **Acceptance on a Vercel preview:** the author's real multi-hundred-MB export parses with the tab staying responsive and numbers matching the classic app. A Playwright smoke test is deferred until the dashboard is ported (it needs a test account).
- CI: the existing `web` job; `fflate` is the only new dependency.

## Intentional differences from the classic parser

- ZIP accepted directly; no 600 MB hard limit (streaming).
- Quote-aware tag tokenizer.
- New users start with no events; re-uploads keep existing events (the classic app attaches the author's semester dates to everyone).
- Sleep timestamps are parsed as ISO local time (`T` separator), so sleep works in Safari (the classic space-separated form is not parsed by Safari).
- `updated_at` refreshed on save.

## Out of scope

Phone-optimized layout, life-event editing, merging several exports, workouts and CDA data, server-side parsing, the charting-library choice, and restyling to match the classic look. The API's outage-vs-no-data ambiguity is not out of scope: it is delivered in this plan (`/api/health` and `/api/chat` answer 503 when Supabase cannot be queried, so an outage no longer tells a user with data that they have none).

## Delivery

One spec, one plan of roughly eight tasks: ZIP spike; metrics + summary; `parseExport` core with fixtures and parity test; input adapters; worker + hook; repository; upload screens; entry points + docs. The route is reachable only by link from inside the new app, and the classic upload keeps working until the cutover.

## Risks

- ZIP64 / data-descriptor support in the unzip library (settled by the spike).
- The localized-filename heuristic for non-English exports.
- Throughput on multi-GB exports; mitigated by streaming and honest progress, verified on a real export.
