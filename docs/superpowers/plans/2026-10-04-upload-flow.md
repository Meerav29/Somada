# Apple Health Upload Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in user drop Apple's `export.zip` (or `export.xml`) into the new app, see a preview computed in their browser, and explicitly save it to their account.

**Architecture:** A pure streaming parser (`parseExport`) turns byte chunks into the existing `HealthData` daily/summary shape using per-day running totals. `fileToChunks` feeds it from a `.xml` file or from a ZIP via streaming unzip. A Web Worker runs both off the main thread; a React hook owns the worker and a small state machine; a repository saves under RLS and carries existing life events over. One upload page renders the states: guide and drop zone, progress, preview, saved, error.

**Tech Stack:** TypeScript (strict), React 19, Vite 8 (module worker), Vitest 5 (`node` environment for parser tests, `jsdom` for UI), `fflate` (streaming unzip, the only new dependency), Supabase JS, TanStack Query. Backend: Python 3.12 stdlib + pytest.

**Spec:** `docs/superpowers/specs/2026-10-04-upload-flow-design.md` (parent: `docs/superpowers/specs/2026-10-03-somada-modernization-design.md`). Task 11 amends two spec sentences that research for this plan showed to be wrong (see Task 11).

## Global Constraints

- "Parsing runs in a Web Worker, is streamed, and is unit-tested against a small fixture. The saved `HealthData` shape does not change."
- "The new flow accepts **both `export.zip` and `export.xml`**."
- "A new upload starts with **no life events**, and a re-upload **keeps the user's existing events**." Never read or copy the demo row's events.
- "After parsing, the user sees a **preview, then explicitly saves**." Nothing is written before the Save button is pressed.
- "**Replace**, not merge" for `daily` and `summary`; "Last write wins across tabs."
- "Only aggregated daily numbers are stored; raw records never leave the browser." Retention window: 18 months.
- "The parse makes no network calls (asserted by a test)." All UI text is rendered through React (no `innerHTML`).
- Output parity with the classic parser: same `daily` and `summary` for the same input (apart from the intentional differences listed in the spec).
- `fflate` is the only new dependency. No `any`, no `@ts-ignore`; TypeScript `strict`.
- Do not edit `index.html` (the classic app keeps working unchanged). Python changes are limited to Task 2.
- Node `^22.13.0 || >=24`; the existing CI jobs (`api`, `web`) must pass.
- Commit messages end with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Work on branch `feat/upload-flow` (default branch is `master`).

## Review Focus

Failure modes the spec implies that a user is most likely to hit, most likely first. Each is pinned by a test in the task that owns the code.

1. **Export with zero usable records** (a new watch, no permissions, or all data older than 18 months) must give a clear error, not an empty dashboard. Test in Task 4.
2. **Truncated or corrupt file** (an interrupted AirDrop, a half-downloaded ZIP) must be an error, never a silently partial import. Tests in Task 4 (missing `</HealthData>`) and Task 6 (truncated ZIP).
3. **Wrong file** (CDA-only XML, an unrelated XML, a ZIP from another app) must give a specific error. Tests in Task 4 (`not-health-export`) and Task 6 (`zip-missing-export`, `wrong-file-type`).
4. **Re-upload keeps the user's events; a new user never gets the demo row's or anyone else's events.** Tests in Task 7.
5. **Save fails, Save is double-clicked, or the user leaves mid-parse:** the parsed result survives a failed save and Retry reuses it, a second Save click does nothing while saving, and cancelling or unmounting terminates the worker. Tests in Task 8.

Also pinned: an API outage must not show as "No health data yet" (Task 2 and Task 10).

## File Structure

```text
api/chat_core.py, api/health.py, api/chat.py            # MODIFY (Task 2): 503 on outage
tests/api/test_chat_core_data.py, test_handlers.py      # MODIFY (Task 2)
scripts/make_zip_fixtures.py                            # NEW (Task 1): tiny ZIP64 fixtures
web/package.json, package-lock.json                     # MODIFY (Task 1): add fflate
web/vite.config.ts                                      # MODIFY (Task 8): worker.format 'es'
web/src/lib/health/
  __fixtures__/zip64-seekable.zip, zip64-streamed.zip   # NEW binary (Task 1)
  __fixtures__/exportFixture.ts                         # NEW (Task 4): XML builders
  __fixtures__/files.ts                                 # NEW (Task 6): chunked File-like helper
  fflate-assumptions.test.ts                            # NEW (Task 1)
  errors.ts                                             # NEW (Task 3): UploadError + codes
  metrics.ts                                            # NEW (Task 3)
  summary.ts (+ .test.ts)                               # NEW (Task 3)
  types.ts                                              # MODIFY (Task 3): ParseStats, ParseResult
  parseExport.ts (+ .test.ts)                           # NEW (Task 4)
  parity.test.ts                                        # NEW (Task 5)
  fileToChunks.ts (+ .test.ts)                          # NEW (Task 6)
  repository.ts (+ .test.ts)                            # NEW (Task 7)
  worker-protocol.ts, parse.worker.ts, createParseWorker.ts   # NEW (Task 8)
  useHealthUpload.ts (+ .test.tsx)                      # NEW (Task 8)
  useHealthQuery.ts                                     # NEW (Task 10)
web/src/features/upload/
  errorMessages.ts, preview.ts, Sparkline.tsx, ExportGuide.tsx, DropZone.tsx,
  ReadingProgress.tsx, PreviewPanel.tsx, ErrorPanel.tsx (+ tests)       # NEW (Task 9)
  UploadPage.tsx (+ .test.tsx)                                          # NEW (Task 10)
web/src/test/fakeWorker.ts, fixtures.ts                 # NEW / MODIFY (Task 8)
web/src/app/{AppRoutes,Shell}.tsx (+ tests), features/dashboard/DashboardPage.tsx (+ test),
web/src/styles.css                                      # MODIFY (Tasks 9-10)
README.md, CLAUDE.md, the two specs                     # MODIFY (Task 11)
```

---

### Task 1: Branch, `fflate` dependency, ZIP64 fixtures, and the library spike

This is a spike with a stop condition: the whole design assumes `fflate`'s streaming `Unzip` handles ZIP64 entries and entries whose sizes live in a trailing data descriptor.

**Files:**
- Create: `scripts/make_zip_fixtures.py`, `web/src/lib/health/__fixtures__/zip64-seekable.zip`, `web/src/lib/health/__fixtures__/zip64-streamed.zip`, `web/src/lib/health/fflate-assumptions.test.ts`
- Modify: `web/package.json`, `web/package-lock.json`

**Interfaces:**
- Produces: `fflate` installed; two committed fixtures, each a ZIP containing `apple_health_export/export.xml` with the exact bytes `<HealthData locale="en_US"><Record type="HKQuantityTypeIdentifierStepCount" startDate="2026-01-12 08:00:00 -0500" value="1"/></HealthData>`, both using ZIP64 local headers; the streamed one also stores sizes in a data descriptor. Later tasks read these via `new URL('./__fixtures__/<name>', import.meta.url)`.

- [ ] **Step 1: Create the branch and commit the spec and this plan**

```bash
cd /c/Users/meera/Github-Projects/Somada
git checkout master && git pull origin master && git checkout -b feat/upload-flow
git add docs/superpowers/specs/2026-10-04-upload-flow-design.md docs/superpowers/plans/2026-10-04-upload-flow.md
git commit -m "docs: add upload flow spec and plan"
```

- [ ] **Step 2: Install the dependency**

```bash
npm --prefix web install fflate
```
Expected: `fflate` added under `dependencies` in `web/package.json` (version 0.8.3 or newer is required: it fixed ZIP64 handling for streamed archives; if npm resolves anything older, stop and report).

- [ ] **Step 3: Write the fixture generator** — `scripts/make_zip_fixtures.py`

```python
"""Generate tiny ZIP64 fixtures for the upload parser tests.

Run from the repo root:  python scripts/make_zip_fixtures.py

Writes web/src/lib/health/__fixtures__/zip64-seekable.zip and zip64-streamed.zip, both
containing apple_health_export/export.xml with ZIP64 local headers. The streamed one is
written to a non-seekable sink, so sizes are stored in a trailing data descriptor.
"""
import pathlib
import zipfile

OUT = pathlib.Path(__file__).parent.parent / "web" / "src" / "lib" / "health" / "__fixtures__"
ENTRY = "apple_health_export/export.xml"
PAYLOAD = (
    b'<HealthData locale="en_US"><Record type="HKQuantityTypeIdentifierStepCount" '
    b'startDate="2026-01-12 08:00:00 -0500" value="1"/></HealthData>'
)


class NonSeekable:
    """Write-only sink: forces zipfile to use data descriptors instead of seeking back."""

    def __init__(self, fh):
        self._fh = fh

    def write(self, data):
        return self._fh.write(data)

    def flush(self):
        self._fh.flush()


def write_zip(path, seekable):
    with open(path, "wb") as raw:
        sink = raw if seekable else NonSeekable(raw)
        with zipfile.ZipFile(sink, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
            info = zipfile.ZipInfo(ENTRY, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            with zf.open(info, "w", force_zip64=True) as entry:
                entry.write(PAYLOAD)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    write_zip(OUT / "zip64-seekable.zip", seekable=True)
    write_zip(OUT / "zip64-streamed.zip", seekable=False)
    print(f"Wrote fixtures to {OUT}")
```

- [ ] **Step 4: Generate the fixtures**

Run: `python scripts/make_zip_fixtures.py && ls -l web/src/lib/health/__fixtures__`
Expected: both `.zip` files exist, each a few hundred bytes.

- [ ] **Step 5: Write the spike test** — `web/src/lib/health/fflate-assumptions.test.ts`

```ts
// @vitest-environment node
// Documents (and guards) what the upload parser assumes about fflate's streaming Unzip.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Unzip, UnzipInflate } from 'fflate'
import { describe, expect, it } from 'vitest'

const ENTRY = 'apple_health_export/export.xml'
const PAYLOAD =
  '<HealthData locale="en_US"><Record type="HKQuantityTypeIdentifierStepCount" ' +
  'startDate="2026-01-12 08:00:00 -0500" value="1"/></HealthData>'

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url))))
}

/** Feed `zip` to a streaming Unzip in `chunkSize` pieces, finishing either with the last real chunk or an empty one. */
function extract(zip: Uint8Array, chunkSize: number, emptyFinal: boolean) {
  const decoder = new TextDecoder()
  const names: string[] = []
  let text = ''
  let finished = false
  const unzip = new Unzip()
  unzip.register(UnzipInflate)
  unzip.onfile = (entry) => {
    names.push(entry.name)
    entry.ondata = (err, data, final) => {
      if (err) throw err
      text += decoder.decode(data, { stream: !final })
      if (final) finished = true
    }
    entry.start()
  }
  for (let i = 0; i < zip.length; i += chunkSize) {
    const last = i + chunkSize >= zip.length
    unzip.push(zip.slice(i, i + chunkSize), last && !emptyFinal)
  }
  if (emptyFinal) unzip.push(new Uint8Array(0), true)
  return { names, text, finished }
}

const cases = ['zip64-seekable.zip', 'zip64-streamed.zip'].flatMap((name) =>
  [1, 7, 4096].flatMap((size) =>
    [false, true].map((emptyFinal) => [name, size, emptyFinal] as const),
  ),
)

describe('fflate streaming Unzip', () => {
  it.each(cases)('extracts %s in %i-byte chunks (emptyFinal=%s)', (name, size, emptyFinal) => {
    const result = extract(fixture(name), size, emptyFinal)
    expect(result.names).toEqual([ENTRY])
    expect(result.finished).toBe(true)
    expect(result.text).toBe(PAYLOAD)
  })
})
```

- [ ] **Step 6: Run the spike**

Run: `npm --prefix web test -- src/lib/health/fflate-assumptions.test.ts`
Expected: all 12 cases PASS.

**STOP CONDITION:** if any case fails, do not change library versions, add workarounds, or continue to Task 2. Report BLOCKED with the failing case names and output. The controller will choose between another unzip library and requiring users to unzip first.

- [ ] **Step 7: Run the web checks and commit**

Run: `npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web test`
Expected: all pass.

```bash
git add scripts/make_zip_fixtures.py web/package.json web/package-lock.json web/src/lib/health
git commit -m "chore(web): add fflate with ZIP64 fixtures and a streaming-unzip spike"
```

---

### Task 2: Backend — an outage is a 503, not "no data"

Spec: the API must not report a Supabase outage as "No health data found", because the new Save flow would then tell a user with data that they have none.

**Files:**
- Modify: `api/chat_core.py` (`fetch_supabase_health_data`), `api/health.py`, `api/chat.py`
- Test: `tests/api/test_chat_core_data.py`, `tests/api/test_handlers.py`

**Interfaces:**
- Produces: `api.chat_core.HealthDataUnavailable(Exception)`. `fetch_supabase_health_data(auth)` raises it when the own-row query or the demo query returns a status other than 200; it still returns `None` for "queried fine, no row and no demo row" and for missing auth. `/api/health` and `/api/chat` answer `503 {"error": "Health data is temporarily unavailable. Please try again."}` when it is raised, before any model call.

- [ ] **Step 1: Update and add the failing tests**

In `tests/api/test_chat_core_data.py`, change the import line to
`from api.chat_core import HealthDataUnavailable, fetch_supabase_health_data, load_health_data`
and replace the two tests `test_failed_own_row_query_does_not_serve_demo` and `test_failed_demo_query_returns_none` with:

```python
@pytest.mark.parametrize("forced", [(503, None), (0, None), (500, None), (401, None)])
def test_failed_own_row_query_raises_and_does_not_serve_demo(fake_supabase, forced):
    fake_supabase["force_status"]["user_id=eq.user-a"] = forced
    ctx = AuthContext(user_id="user-a", token="token-a")
    with pytest.raises(HealthDataUnavailable):
        fetch_supabase_health_data(ctx)
    assert all("is_demo" not in url for url, _ in fake_supabase["calls"])


def test_failed_demo_query_raises(fake_supabase):
    fake_supabase["users"]["token-c"] = "user-c"
    fake_supabase["force_status"]["is_demo=eq.true"] = (503, None)
    ctx = AuthContext(user_id="user-c", token="token-c")
    with pytest.raises(HealthDataUnavailable):
        fetch_supabase_health_data(ctx)
```

Append to `tests/api/test_handlers.py`:

```python
def test_health_outage_is_503_not_no_data(fake_supabase, call):
    fake_supabase["force_status"]["user_id=eq.user-a"] = (503, None)
    status, body = call(health_module.handler, headers=bearer("token-a"))
    assert status == 503
    assert body == {"error": "Health data is temporarily unavailable. Please try again."}


def test_chat_outage_is_503_and_never_calls_the_model(fake_supabase, call, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "server-key")
    calls = []
    monkeypatch.setattr(chat_module, "chat_with_claude", lambda *a, **k: calls.append(a) or "x")
    fake_supabase["force_status"]["user_id=eq.user-a"] = (503, None)
    status, body = call(
        chat_module.handler,
        "POST",
        headers=bearer("token-a"),
        body={"message": "hi", "chatMode": "claude"},
    )
    assert status == 503 and "error" in body
    assert calls == []
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/api/test_chat_core_data.py tests/api/test_handlers.py -q`
Expected: FAIL (`ImportError: cannot import name 'HealthDataUnavailable'`).

- [ ] **Step 3: Implement** — in `api/chat_core.py`, add above `fetch_supabase_health_data`:

```python
class HealthDataUnavailable(Exception):
    """Supabase could not be queried, so we cannot say whether the user has data."""
```

and replace the body of `fetch_supabase_health_data` after the `base = ...` line with:

```python
    status, rows = supabase_http.http_get_json(
        f"{base}&user_id=eq.{urllib.parse.quote(auth.user_id, safe='')}", headers
    )
    if status != 200:
        # An outage must never look like "no data" and must never serve the demo row.
        raise HealthDataUnavailable(f"health_data query failed with status {status}")
    if rows:
        return rows[0].get("data")

    # Signed in, query succeeded, no row yet: fall back to the shared demo data.
    status, rows = supabase_http.http_get_json(f"{base}&is_demo=eq.true", headers)
    if status != 200:
        raise HealthDataUnavailable(f"demo data query failed with status {status}")
    if rows:
        data = rows[0].get("data")
        if isinstance(data, dict):
            return {**data, "is_demo": True}
        return data
    return None
```

In `api/health.py` change the import to `from api.chat_core import HealthDataUnavailable, load_health_data` and replace the data-loading lines with:

```python
        try:
            data = load_health_data(auth=auth)
        except HealthDataUnavailable:
            self._send_json(
                {"error": "Health data is temporarily unavailable. Please try again."}, 503
            )
            return
        if data is None:
            data = {"error": "No health data found."}
        self._send_json(data)
```

In `api/chat.py` add `HealthDataUnavailable,` to the `from api.chat_core import (...)` list and replace `health_data = load_health_data(auth=auth)` with:

```python
        try:
            health_data = load_health_data(auth=auth)
        except HealthDataUnavailable:
            self._send_json(
                {"error": "Health data is temporarily unavailable. Please try again."}, 503
            )
            return
```

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest -q`
Expected: all Python tests PASS (the previous 54 plus the 2 new handler tests and the new parametrized cases).

- [ ] **Step 5: Commit**

```bash
git add api tests/api
git commit -m "fix(api): report a Supabase outage as 503 instead of 'no health data'"
```

---

### Task 3: Foundations — errors, metrics, summary, result types

**Files:**
- Create: `web/src/lib/health/errors.ts`, `web/src/lib/health/metrics.ts`, `web/src/lib/health/summary.ts`, `web/src/lib/health/summary.test.ts`
- Modify: `web/src/lib/health/types.ts` (append)

**Interfaces:**
- Produces (`errors.ts`): `UPLOAD_ERROR_CODES` (readonly tuple), `type UploadErrorCode`, `interface UploadErrorInfo { code: UploadErrorCode; message: string }`, `class UploadError extends Error { readonly code: UploadErrorCode; constructor(code, message?) }`.
- Produces (`metrics.ts`): `type Metric`, `METRIC_BY_TYPE: ReadonlyMap<string, Metric>`, `SLEEP_ASLEEP: ReadonlySet<string>`, `RETENTION_MONTHS = 18`.
- Produces (`summary.ts`): `computeSummaryStats(days: DailyEntry[]): HealthSummary` (same behaviour as the classic function: null-safe min/max, averages rounded to 1 decimal, `best_steps_day`).
- Produces (`types.ts`): `ParseStats { recordsSeen, recordsKept, firstDate: string | null, lastDate: string | null, bytesRead, maxCarryBytes }` and `ParseResult { daily: Record<string, DailyEntry>; summary: HealthSummary; stats: ParseStats }`.

- [ ] **Step 1: Write the failing tests** — `web/src/lib/health/summary.test.ts` (ported from `tests/js/summary_stats.test.mjs`)

```ts
import { describe, expect, it } from 'vitest'
import { computeSummaryStats } from './summary'
import type { DailyEntry } from './types'

function day(date: string, steps: number | null, sleep: number | null): DailyEntry {
  return {
    date,
    steps,
    heart_rate_avg: null,
    heart_rate_min: null,
    heart_rate_max: null,
    resting_hr: null,
    hrv: null,
    sleep_hours: sleep,
    active_calories: null,
    exercise_minutes: null,
    spo2: null,
  }
}

const days = (sleeps: (number | null)[]) =>
  sleeps.map((s, i) => day(`2025-01-0${i + 1}`, 1000 * (i + 1), s))

describe('computeSummaryStats', () => {
  it('computes best and worst sleep over positive values', () => {
    const s = computeSummaryStats(days([7, 6.5, 8]))
    expect(s.worst_sleep).toBe(6.5)
    expect(s.best_sleep).toBe(8)
  })

  it('ignores nulls', () => {
    const s = computeSummaryStats(days([null, 7, null, 5.5]))
    expect(s.worst_sleep).toBe(5.5)
    expect(s.best_sleep).toBe(7)
  })

  it('keeps no-data stats null instead of 0', () => {
    for (const input of [[], days([null, null])]) {
      const s = computeSummaryStats(input)
      expect(s.worst_sleep).toBeNull()
      expect(s.best_sleep).toBeNull()
      expect(s.avg_sleep_hours).toBeNull()
    }
  })

  it('computes the other stats', () => {
    const s = computeSummaryStats(days([7, 6.5, 8]))
    expect(s.best_steps_day).toBe('2025-01-03')
    expect(s.total_days).toBe(3)
    expect(s.avg_steps).toBe(2000)
    expect(computeSummaryStats([]).best_steps_day).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm --prefix web test -- src/lib/health/summary.test.ts`
Expected: FAIL, cannot resolve `./summary`.

- [ ] **Step 3: Implement**

`web/src/lib/health/errors.ts`:
```ts
export const UPLOAD_ERROR_CODES = [
  'wrong-file-type',
  'empty-file',
  'zip-missing-export',
  'not-health-export',
  'corrupt-file',
  'no-usable-records',
  'worker-failed',
  'save-failed',
  'session-expired',
  'not-configured',
] as const

export type UploadErrorCode = (typeof UPLOAD_ERROR_CODES)[number]

export interface UploadErrorInfo {
  code: UploadErrorCode
  /** Technical detail for debugging; the UI shows its own wording per code. */
  message: string
}

export class UploadError extends Error {
  readonly code: UploadErrorCode

  constructor(code: UploadErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'UploadError'
    this.code = code
  }
}
```

`web/src/lib/health/metrics.ts`:
```ts
// Copied from the classic parser (index.html: HEALTH_METRIC_MAP, SLEEP_ASLEEP).
export type Metric =
  | 'steps'
  | 'heart_rate'
  | 'resting_heart_rate'
  | 'hrv'
  | 'sleep'
  | 'active_calories'
  | 'exercise_minutes'
  | 'spo2'
  | 'respiratory_rate'
  | 'walking_hr'

export const METRIC_BY_TYPE: ReadonlyMap<string, Metric> = new Map<string, Metric>([
  ['HKQuantityTypeIdentifierStepCount', 'steps'],
  ['HKQuantityTypeIdentifierHeartRate', 'heart_rate'],
  ['HKQuantityTypeIdentifierRestingHeartRate', 'resting_heart_rate'],
  ['HKQuantityTypeIdentifierHeartRateVariabilitySDNN', 'hrv'],
  ['HKCategoryTypeIdentifierSleepAnalysis', 'sleep'],
  ['HKQuantityTypeIdentifierActiveEnergyBurned', 'active_calories'],
  ['HKQuantityTypeIdentifierAppleExerciseTime', 'exercise_minutes'],
  ['HKQuantityTypeIdentifierOxygenSaturation', 'spo2'],
  ['HKQuantityTypeIdentifierRespiratoryRate', 'respiratory_rate'],
  ['HKQuantityTypeIdentifierWalkingHeartRateAverage', 'walking_hr'],
])

export const SLEEP_ASLEEP: ReadonlySet<string> = new Set([
  'HKCategoryValueSleepAnalysisAsleep',
  'HKCategoryValueSleepAnalysisCore',
  'HKCategoryValueSleepAnalysisDeep',
  'HKCategoryValueSleepAnalysisREM',
  'HKCategoryValueSleepAnalysisAsleepCore',
  'HKCategoryValueSleepAnalysisAsleepDeep',
  'HKCategoryValueSleepAnalysisAsleepREM',
  'HKCategoryValueSleepAnalysisAsleepUnspecified',
])

/** Months of history kept, as in the classic app (DATA_RETENTION_MONTHS). */
export const RETENTION_MONTHS = 18
```

`web/src/lib/health/summary.ts`:
```ts
import type { DailyEntry, HealthSummary } from './types'

type Maybe = number | null

const present = (values: Maybe[]): number[] => values.filter((v): v is number => v != null)

function avgStat(values: Maybe[]): Maybe {
  const c = present(values)
  return c.length ? +(c.reduce((a, b) => a + b, 0) / c.length).toFixed(1) : null
}

// Seed-free min/max: a null seed would coerce to 0 in Math.min/Math.max.
function extreme(values: Maybe[], pick: (...n: number[]) => number): Maybe {
  const c = present(values)
  return c.length ? pick(...c) : null
}

/** Port of the classic computeSummaryStats (index.html). */
export function computeSummaryStats(days: DailyEntry[]): HealthSummary {
  const bestStepsDay = days.reduce<DailyEntry | null>(
    (best, d) => (!best || (d.steps || 0) > (best.steps || 0) ? d : best),
    null,
  )
  return {
    avg_steps: avgStat(days.map((d) => d.steps)),
    avg_sleep_hours: avgStat(days.map((d) => d.sleep_hours)),
    avg_resting_hr: avgStat(days.map((d) => d.resting_hr)),
    avg_hrv: avgStat(days.map((d) => d.hrv)),
    best_sleep: extreme(days.map((d) => d.sleep_hours), Math.max),
    worst_sleep: extreme(days.map((d) => d.sleep_hours), Math.min),
    best_steps_day: bestStepsDay ? bestStepsDay.date : null,
    total_days: days.length,
  }
}
```

Append to `web/src/lib/health/types.ts`:
```ts

export interface ParseStats {
  /** Every <Record> tag seen, whatever its type. */
  recordsSeen: number
  /** Records of a known metric that fall inside the retention window. */
  recordsKept: number
  firstDate: string | null
  lastDate: string | null
  /** Decoded XML bytes consumed. */
  bytesRead: number
  /** Largest partial-tag buffer held between chunks (memory-bound check). */
  maxCarryBytes: number
}

export interface ParseResult {
  daily: Record<string, DailyEntry>
  summary: HealthSummary
  stats: ParseStats
}
```

- [ ] **Step 4: Run to verify pass, then the full checks**

Run: `npm --prefix web test -- src/lib/health/summary.test.ts` -> Expected: 4 PASS.
Run: `npm --prefix web run lint && npm --prefix web run typecheck` -> Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/health
git commit -m "feat(web): upload error codes, metric map, summary stats and parse result types"
```

---

### Task 4: `parseExport` — the streaming parser core

**Files:**
- Create: `web/src/lib/health/__fixtures__/exportFixture.ts`, `web/src/lib/health/parseExport.ts`, `web/src/lib/health/parseExport.test.ts`

**Interfaces:**
- Consumes: `UploadError`, `METRIC_BY_TYPE`, `SLEEP_ASLEEP`, `RETENTION_MONTHS`, `computeSummaryStats`, `DailyEntry`, `ParseResult`.
- Produces (`parseExport.ts`): `interface ParseProgress { recordsSeen: number; xmlBytes: number }`; `interface ParseOptions { onProgress?: (p: ParseProgress) => void; now?: Date; retentionMonths?: number }`; `retentionCutoff(now: Date, months: number): string` (`YYYY-MM-DD`); `parseExport(chunks: AsyncIterable<Uint8Array>, options?: ParseOptions): Promise<ParseResult>`.
- Throws `UploadError` with codes `not-health-export` (the first 64 KB lacks `<HealthData`), `corrupt-file` (no closing `</HealthData>`, or an unterminated `<Record` longer than 1,000,000 characters), `no-usable-records` (no known-metric record inside the retention window).
- Produces (`exportFixture.ts`): `FIXTURE_NOW`, `record(type, start, value, opts?)`, `exportXml(body)`, `standardFixtureXml()`, `toChunks(text, size)`.

Behaviour that must match the classic parser (verified by Task 5): a day entry is created for **every** mapped-metric record inside the window — including `respiratory_rate` and `walking_hr` records and sleep records that are not "asleep" — even when no value is accumulated, because the classic parser creates the day before reading the value. Sums accumulate in the same order, so averages are bit-identical.

- [ ] **Step 1: Write the fixture helpers** — `web/src/lib/health/__fixtures__/exportFixture.ts`

```ts
export const TYPE = {
  steps: 'HKQuantityTypeIdentifierStepCount',
  heartRate: 'HKQuantityTypeIdentifierHeartRate',
  resting: 'HKQuantityTypeIdentifierRestingHeartRate',
  hrv: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  sleep: 'HKCategoryTypeIdentifierSleepAnalysis',
  calories: 'HKQuantityTypeIdentifierActiveEnergyBurned',
  exercise: 'HKQuantityTypeIdentifierAppleExerciseTime',
  spo2: 'HKQuantityTypeIdentifierOxygenSaturation',
  respiratory: 'HKQuantityTypeIdentifierRespiratoryRate',
  walkingHr: 'HKQuantityTypeIdentifierWalkingHeartRateAverage',
  bodyMass: 'HKQuantityTypeIdentifierBodyMass',
} as const

/** Retention cutoff for this "now" with 18 months is 2024-09-01. */
export const FIXTURE_NOW = new Date('2026-03-01T12:00:00Z')

export function record(
  type: string,
  start: string,
  value: string | number,
  opts: { end?: string; source?: string; children?: string } = {},
): string {
  const end = opts.end ?? start
  const source = opts.source ?? 'Watch'
  const open =
    `<Record type="${type}" sourceName="${source}" unit="u" creationDate="${start}" ` +
    `startDate="${start}" endDate="${end}" value="${value}"`
  return opts.children ? `${open}>${opts.children}</Record>` : `${open}/>`
}

export function exportXml(body: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE HealthData [\n' +
    '<!ELEMENT HealthData (ExportDate,Me,(Record|Correlation|Workout|ActivitySummary)*)>\n' +
    ']>\n' +
    '<HealthData locale="en_US">\n' +
    ' <ExportDate value="2026-03-01 08:00:00 -0500"/>\n' +
    ' <Me HKCharacteristicTypeIdentifierBiologicalSex="HKBiologicalSexNotSet"/>\n' +
    `${body}\n` +
    '</HealthData>\n'
  )
}

const at = (date: string, time: string) => `${date} ${time} -0500`

/**
 * 25 <Record> tags over these days (all times local, January so no DST edge cases):
 *  01-10  only an InBed sleep record            -> day exists, everything null
 *  01-11  8.00 h asleep (450 + 30 min), 4000 steps
 *  01-12  steps 1000 + 2000.4 + 500 (one with a MetadataEntry child and a non-ASCII source),
 *         heart rate 60 / 72.5 / 90 plus one non-numeric, resting 58, hrv 40 / 50
 *  01-13  calories 100.4 + 200.4, exercise 10 + 20.4, spo2 97 / 98, respiratory 15
 *  01-14  only a walking-HR record               -> day exists, everything null
 * plus an unmapped BodyMass record (ignored) and a 2023 steps record (outside retention),
 * a <Workout> and an <ActivitySummary> element (ignored).
 */
export function standardFixtureXml(): string {
  const r: string[] = [
    record(TYPE.sleep, at('2026-01-10', '22:30:00'), 'HKCategoryValueSleepAnalysisInBed', {
      end: at('2026-01-11', '06:00:00'),
    }),
    record(TYPE.sleep, at('2026-01-11', '23:00:00'), 'HKCategoryValueSleepAnalysisAsleepCore', {
      end: at('2026-01-12', '06:30:00'),
    }),
    record(TYPE.sleep, at('2026-01-11', '23:30:00'), 'HKCategoryValueSleepAnalysisREM', {
      end: at('2026-01-12', '00:00:00'),
    }),
    record(TYPE.sleep, at('2026-01-11', '22:30:00'), 'HKCategoryValueSleepAnalysisInBed', {
      end: at('2026-01-12', '06:45:00'),
    }),
    record(TYPE.steps, at('2026-01-11', '09:00:00'), 4000),
    record(TYPE.steps, at('2026-01-12', '08:00:00'), 1000, { source: 'Müller’s 日本語 Watch' }),
    record(TYPE.steps, at('2026-01-12', '12:00:00'), 2000.4),
    record(TYPE.steps, at('2026-01-12', '18:00:00'), 500, {
      children: '<MetadataEntry key="HKMetadataKeySyncVersion" value="999"/>',
    }),
    record(TYPE.heartRate, at('2026-01-12', '08:05:00'), 60),
    record(TYPE.heartRate, at('2026-01-12', '12:05:00'), 72.5),
    record(TYPE.heartRate, at('2026-01-12', '18:05:00'), 90),
    record(TYPE.heartRate, at('2026-01-12', '19:05:00'), 'abc'),
    record(TYPE.resting, at('2026-01-12', '07:00:00'), 58),
    record(TYPE.hrv, at('2026-01-12', '03:00:00'), 40),
    record(TYPE.hrv, at('2026-01-12', '04:00:00'), 50),
    record(TYPE.calories, at('2026-01-13', '10:00:00'), 100.4),
    record(TYPE.calories, at('2026-01-13', '11:00:00'), 200.4),
    record(TYPE.exercise, at('2026-01-13', '10:00:00'), 10),
    record(TYPE.exercise, at('2026-01-13', '11:00:00'), 20.4),
    record(TYPE.spo2, at('2026-01-13', '12:00:00'), 97),
    record(TYPE.spo2, at('2026-01-13', '13:00:00'), 98),
    record(TYPE.respiratory, at('2026-01-13', '14:00:00'), 15),
    record(TYPE.walkingHr, at('2026-01-14', '09:00:00'), 100),
    record(TYPE.bodyMass, at('2026-01-12', '07:00:00'), 70),
    record(TYPE.steps, at('2023-01-01', '09:00:00'), 99999),
    '<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" startDate="2026-01-12 06:00:00 -0500"/>',
    '<ActivitySummary dateComponents="2026-01-12" activeEnergyBurned="300"/>',
  ]
  return exportXml(r.join('\n'))
}

/** Encode `text` as UTF-8 and yield it in `size`-byte chunks (which may split multi-byte characters). */
export async function* toChunks(text: string, size: number): AsyncGenerator<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  for (let i = 0; i < bytes.length; i += size) {
    yield bytes.slice(i, i + size)
  }
}
```

- [ ] **Step 2: Write the failing tests** — `web/src/lib/health/parseExport.test.ts`

```ts
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FIXTURE_NOW,
  TYPE,
  exportXml,
  record,
  standardFixtureXml,
  toChunks,
} from './__fixtures__/exportFixture'
import { parseExport, retentionCutoff } from './parseExport'

afterEach(() => {
  vi.unstubAllGlobals()
})

const parse = (xml: string, size = 1_000_000) => parseExport(toChunks(xml, size), { now: FIXTURE_NOW })

const NULLS = {
  steps: null,
  heart_rate_avg: null,
  heart_rate_min: null,
  heart_rate_max: null,
  resting_hr: null,
  hrv: null,
  sleep_hours: null,
  active_calories: null,
  exercise_minutes: null,
  spo2: null,
}

describe('retentionCutoff', () => {
  it('goes back the given number of months', () => {
    expect(retentionCutoff(FIXTURE_NOW, 18)).toBe('2024-09-01')
  })
})

describe('parseExport on the standard fixture', () => {
  it('aggregates every day', async () => {
    const { daily } = await parse(standardFixtureXml())
    expect(Object.keys(daily)).toEqual([
      '2026-01-10',
      '2026-01-11',
      '2026-01-12',
      '2026-01-13',
      '2026-01-14',
    ])
    expect(daily['2026-01-10']).toEqual({ date: '2026-01-10', ...NULLS })
    expect(daily['2026-01-11']).toEqual({ date: '2026-01-11', ...NULLS, steps: 4000, sleep_hours: 8 })
    expect(daily['2026-01-12']).toEqual({
      date: '2026-01-12',
      ...NULLS,
      steps: 3500,
      heart_rate_avg: 74.2,
      heart_rate_min: 60,
      heart_rate_max: 90,
      resting_hr: 58,
      hrv: 45,
    })
    expect(daily['2026-01-13']).toEqual({
      date: '2026-01-13',
      ...NULLS,
      active_calories: 301,
      exercise_minutes: 30,
      spo2: 97.5,
    })
    // A day that only has a walking-HR record still exists (as in the classic parser).
    expect(daily['2026-01-14']).toEqual({ date: '2026-01-14', ...NULLS })
  })

  it('computes the summary', async () => {
    const { summary } = await parse(standardFixtureXml())
    expect(summary).toEqual({
      avg_steps: 3750,
      avg_sleep_hours: 8,
      avg_resting_hr: 58,
      avg_hrv: 45,
      best_sleep: 8,
      worst_sleep: 8,
      best_steps_day: '2026-01-11',
      total_days: 5,
    })
  })

  it('drops records older than the retention window', async () => {
    const { daily } = await parse(standardFixtureXml())
    expect(daily['2023-01-01']).toBeUndefined()
  })

  it('reports stats', async () => {
    const xml = standardFixtureXml()
    const { stats } = await parse(xml)
    expect(stats.recordsSeen).toBe(25)
    expect(stats.recordsKept).toBe(23)
    expect(stats.firstDate).toBe('2026-01-10')
    expect(stats.lastDate).toBe('2026-01-14')
    expect(stats.bytesRead).toBe(new TextEncoder().encode(xml).length)
  })

  it.each([1, 7, 64])('gives the same result for %i-byte chunks as for one chunk', async (size) => {
    const xml = standardFixtureXml()
    const whole = await parse(xml)
    const chunked = await parse(xml, size)
    expect(chunked.daily).toEqual(whole.daily)
    expect(chunked.summary).toEqual(whole.summary)
    expect(chunked.stats.recordsSeen).toBe(whole.stats.recordsSeen)
    expect(chunked.stats.recordsKept).toBe(whole.stats.recordsKept)
    expect(chunked.stats.bytesRead).toBe(whole.stats.bytesRead)
  })

  it('reports increasing progress that ends at the total size', async () => {
    const xml = standardFixtureXml()
    const seen: { recordsSeen: number; xmlBytes: number }[] = []
    await parseExport(toChunks(xml, 100), { now: FIXTURE_NOW, onProgress: (p) => seen.push(p) })
    expect(seen.length).toBeGreaterThan(1)
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i].xmlBytes).toBeGreaterThan(seen[i - 1].xmlBytes)
      expect(seen[i].recordsSeen).toBeGreaterThanOrEqual(seen[i - 1].recordsSeen)
    }
    expect(seen.at(-1)).toEqual({ recordsSeen: 25, xmlBytes: new TextEncoder().encode(xml).length })
  })

  it('makes no network calls', async () => {
    vi.stubGlobal('fetch', () => {
      throw new Error('network call during parse')
    })
    await expect(parse(standardFixtureXml(), 64)).resolves.toBeDefined()
  })
})

describe('tokenizer details', () => {
  it('handles a ">" inside a quoted attribute value', async () => {
    const xml = exportXml(
      record(TYPE.steps, '2026-01-12 08:00:00 -0500', 1234, { source: 'A > B <Watch>' }),
    )
    const { daily } = await parse(xml, 5)
    expect(daily['2026-01-12'].steps).toBe(1234)
  })

  it('ignores values of nested MetadataEntry children', async () => {
    const xml = exportXml(
      record(TYPE.steps, '2026-01-12 08:00:00 -0500', 10, {
        children: '<MetadataEntry key="k" value="999"/>',
      }),
    )
    const { daily } = await parse(xml)
    expect(daily['2026-01-12'].steps).toBe(10)
  })

  it('does not treat <RecordFoo> elements as records', async () => {
    const body = [
      '<RecordFoo type="HKQuantityTypeIdentifierStepCount" startDate="2026-01-12 08:00:00 -0500" value="5"/>',
      record(TYPE.steps, '2026-01-13 08:00:00 -0500', 7),
    ].join('\n')
    const { daily, stats } = await parse(exportXml(body))
    expect(Object.keys(daily)).toEqual(['2026-01-13'])
    expect(stats.recordsSeen).toBe(1)
  })

  it('keeps the partial-tag buffer small over a long stream', async () => {
    async function* many(): AsyncGenerator<Uint8Array> {
      const encoder = new TextEncoder()
      yield encoder.encode(exportXml('').replace('</HealthData>\n', ''))
      for (let i = 0; i < 20_000; i++) {
        const day = String((i % 28) + 1).padStart(2, '0')
        yield encoder.encode(record(TYPE.steps, `2026-01-${day} 08:00:00 -0500`, 1) + '\n')
      }
      yield encoder.encode('</HealthData>\n')
    }
    const { stats } = await parseExport(many(), { now: FIXTURE_NOW })
    expect(stats.recordsKept).toBe(20_000)
    expect(stats.maxCarryBytes).toBeLessThan(1000)
  })
})

describe('error cases', () => {
  it('rejects XML that is not an Apple Health export', async () => {
    await expect(parse('<?xml version="1.0"?><note><to>x</to></note>')).rejects.toMatchObject({
      code: 'not-health-export',
    })
  })

  it('rejects an empty stream', async () => {
    await expect(parse('')).rejects.toMatchObject({ code: 'not-health-export' })
  })

  it('rejects a truncated file (no closing </HealthData>)', async () => {
    const xml = standardFixtureXml()
    const truncated = xml.slice(0, xml.length - 200)
    await expect(parse(truncated, 64)).rejects.toMatchObject({ code: 'corrupt-file' })
  })

  it('rejects an export with no usable records', async () => {
    const xml = exportXml(record(TYPE.bodyMass, '2026-01-12 08:00:00 -0500', 70))
    await expect(parse(xml)).rejects.toMatchObject({ code: 'no-usable-records' })
  })

  it('rejects an export whose records are all outside the retention window', async () => {
    const xml = exportXml(record(TYPE.steps, '2020-01-12 08:00:00 -0500', 100))
    await expect(parse(xml)).rejects.toMatchObject({ code: 'no-usable-records' })
  })

  it('rejects an unterminated <Record> that grows without bound', async () => {
    const xml = exportXml('').replace('</HealthData>\n', '') + '<Record type="x" ' + 'a'.repeat(1_100_000)
    await expect(parse(xml, 100_000)).rejects.toMatchObject({ code: 'corrupt-file' })
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npm --prefix web test -- src/lib/health/parseExport.test.ts`
Expected: FAIL, cannot resolve `./parseExport`.

- [ ] **Step 4: Implement** — `web/src/lib/health/parseExport.ts`

```ts
import { UploadError } from './errors'
import { METRIC_BY_TYPE, RETENTION_MONTHS, SLEEP_ASLEEP } from './metrics'
import { computeSummaryStats } from './summary'
import type { DailyEntry, ParseResult } from './types'

export interface ParseProgress {
  recordsSeen: number
  xmlBytes: number
}

export interface ParseOptions {
  onProgress?: (progress: ParseProgress) => void
  /** Injectable clock for the retention cutoff (tests). */
  now?: Date
  retentionMonths?: number
}

// Quote-aware: a ">" inside a quoted attribute value does not end the tag.
const RECORD_RE = /<Record\b((?:[^>"]|"[^"]*")*)>/g
const ATTR_TYPE = /\stype="([^"]*)"/
const ATTR_START = /\sstartDate="([^"]*)"/
const ATTR_END = /\sendDate="([^"]*)"/
const ATTR_VALUE = /\svalue="([^"]*)"/
const RECORD_OPEN = '<Record'
const CLOSING_TAG = '</HealthData>'
const MAX_CARRY_CHARS = 1_000_000
const HEADER_CHARS = 65_536

interface DayAcc {
  steps: number
  stepsN: number
  hrSum: number
  hrN: number
  hrMin: number
  hrMax: number
  restSum: number
  restN: number
  hrvSum: number
  hrvN: number
  sleepMinutes: number
  calSum: number
  calN: number
  exSum: number
  exN: number
  o2Sum: number
  o2N: number
}

function newDay(): DayAcc {
  return {
    steps: 0,
    stepsN: 0,
    hrSum: 0,
    hrN: 0,
    hrMin: Infinity,
    hrMax: -Infinity,
    restSum: 0,
    restN: 0,
    hrvSum: 0,
    hrvN: 0,
    sleepMinutes: 0,
    calSum: 0,
    calN: 0,
    exSum: 0,
    exN: 0,
    o2Sum: 0,
    o2N: 0,
  }
}

function toEntry(date: string, d: DayAcc): DailyEntry {
  const avg = (sum: number, n: number, digits: number) => (n ? +(sum / n).toFixed(digits) : null)
  return {
    date,
    steps: d.stepsN ? Math.round(d.steps) : null,
    heart_rate_avg: avg(d.hrSum, d.hrN, 1),
    heart_rate_min: d.hrN ? +d.hrMin.toFixed(1) : null,
    heart_rate_max: d.hrN ? +d.hrMax.toFixed(1) : null,
    resting_hr: avg(d.restSum, d.restN, 1),
    hrv: avg(d.hrvSum, d.hrvN, 1),
    sleep_hours: d.sleepMinutes > 0 ? +(d.sleepMinutes / 60).toFixed(2) : null,
    active_calories: d.calN ? Math.round(d.calSum) : null,
    exercise_minutes: d.exN ? Math.round(d.exSum) : null,
    spo2: avg(d.o2Sum, d.o2N, 1),
  }
}

/** First capture group of `re` in `attrs`, or null. */
function attr(re: RegExp, attrs: string): string | null {
  const m = re.exec(attrs)
  return m ? m[1] : null
}

// "2026-01-12 08:00:00 -0500" -> local time of the first 19 characters. The "T" makes this
// parse the same way in every browser (Safari rejects the space-separated form).
const localMs = (stamp: string) => new Date(stamp.slice(0, 19).replace(' ', 'T')).getTime()

export function retentionCutoff(now: Date, months: number): string {
  const cutoff = new Date(now.getTime())
  cutoff.setMonth(cutoff.getMonth() - months)
  return cutoff.toISOString().slice(0, 10)
}

/** Returns true when the record belongs to a known metric inside the retention window. */
function addRecord(days: Map<string, DayAcc>, attrs: string, cutoff: string): boolean {
  const type = attr(ATTR_TYPE, attrs)
  const metric = type === null ? undefined : METRIC_BY_TYPE.get(type)
  if (!metric) return false
  const startDate = attr(ATTR_START, attrs)
  if (!startDate) return false
  const dateKey = startDate.slice(0, 10)
  if (dateKey < cutoff) return false

  // The classic parser creates the day before reading the value, so a day exists even when
  // only a respiratory-rate, walking-HR or non-asleep sleep record is present.
  let day = days.get(dateKey)
  if (!day) {
    day = newDay()
    days.set(dateKey, day)
  }

  if (metric === 'sleep') {
    const value = attr(ATTR_VALUE, attrs)
    const endDate = attr(ATTR_END, attrs)
    if (value !== null && SLEEP_ASLEEP.has(value) && endDate) {
      const minutes = (localMs(endDate) - localMs(startDate)) / 60000
      if (minutes > 0 && minutes < 720) day.sleepMinutes += minutes
    }
    return true
  }

  const value = parseFloat(attr(ATTR_VALUE, attrs) ?? '')
  if (Number.isNaN(value)) return true
  switch (metric) {
    case 'steps':
      day.steps += value
      day.stepsN++
      break
    case 'heart_rate':
      day.hrSum += value
      day.hrN++
      day.hrMin = Math.min(day.hrMin, value)
      day.hrMax = Math.max(day.hrMax, value)
      break
    case 'resting_heart_rate':
      day.restSum += value
      day.restN++
      break
    case 'hrv':
      day.hrvSum += value
      day.hrvN++
      break
    case 'active_calories':
      day.calSum += value
      day.calN++
      break
    case 'exercise_minutes':
      day.exSum += value
      day.exN++
      break
    case 'spo2':
      day.o2Sum += value
      day.o2N++
      break
    default:
      // respiratory_rate and walking_hr are never saved (classic parser parity).
      break
  }
  return true
}

export async function parseExport(
  chunks: AsyncIterable<Uint8Array>,
  options: ParseOptions = {},
): Promise<ParseResult> {
  const cutoff = retentionCutoff(options.now ?? new Date(), options.retentionMonths ?? RETENTION_MONTHS)
  const decoder = new TextDecoder('utf-8')
  const days = new Map<string, DayAcc>()
  let carry = ''
  let head = ''
  let headerChecked = false
  let tail = ''
  let recordsSeen = 0
  let recordsKept = 0
  let xmlBytes = 0
  let maxCarry = 0

  const checkHeader = () => {
    headerChecked = true
    if (!head.includes('<HealthData')) {
      throw new UploadError('not-health-export', 'The file has no <HealthData> root element')
    }
  }

  /** Process every complete <Record> in `text`; return the unfinished tail to carry forward. */
  const scan = (text: string): string => {
    RECORD_RE.lastIndex = 0
    let lastEnd = 0
    for (let m = RECORD_RE.exec(text); m !== null; m = RECORD_RE.exec(text)) {
      lastEnd = RECORD_RE.lastIndex
      recordsSeen++
      if (addRecord(days, m[1], cutoff)) recordsKept++
    }
    const rest = text.slice(lastEnd)
    const open = rest.indexOf(RECORD_OPEN)
    // Keep from an unfinished "<Record", or the last few characters in case "<Record" is split.
    const keep = open >= 0 ? rest.slice(open) : rest.slice(Math.max(0, rest.length - RECORD_OPEN.length))
    if (keep.length > MAX_CARRY_CHARS) {
      throw new UploadError('corrupt-file', 'A <Record> tag never ends')
    }
    maxCarry = Math.max(maxCarry, keep.length)
    return keep
  }

  const ingest = (text: string) => {
    if (!headerChecked) {
      head += text
      if (head.length >= HEADER_CHARS) checkHeader()
    }
    tail = (tail + text).slice(-32)
    carry = scan(carry + text)
  }

  for await (const chunk of chunks) {
    xmlBytes += chunk.length
    ingest(decoder.decode(chunk, { stream: true }))
    options.onProgress?.({ recordsSeen, xmlBytes })
  }
  const flushed = decoder.decode()
  if (flushed) ingest(flushed)

  if (!headerChecked) checkHeader()
  if (!tail.includes(CLOSING_TAG)) {
    throw new UploadError('corrupt-file', 'The file ends before </HealthData>')
  }
  if (days.size === 0) {
    throw new UploadError('no-usable-records', 'No known health records inside the retention window')
  }

  const daily: Record<string, DailyEntry> = {}
  const sorted = [...days.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  for (const [date, acc] of sorted) daily[date] = toEntry(date, acc)
  const dates = sorted.map(([date]) => date)

  return {
    daily,
    summary: computeSummaryStats(Object.values(daily)),
    stats: {
      recordsSeen,
      recordsKept,
      firstDate: dates[0] ?? null,
      lastDate: dates.at(-1) ?? null,
      bytesRead: xmlBytes,
      maxCarryBytes: maxCarry,
    },
  }
}
```

- [ ] **Step 5: Run to verify pass, then the full checks**

Run: `npm --prefix web test -- src/lib/health/parseExport.test.ts` -> Expected: all PASS.
Run: `npm --prefix web test && npm --prefix web run lint && npm --prefix web run typecheck` -> Expected: exit 0.

If an expected number in the first test fails, recompute it by hand from the fixture comment before changing code. The code mirrors the classic parser, so a mismatch most likely means a typo in the fixture or in the expectation.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/health
git commit -m "feat(web): streaming Apple Health parser core with fixtures and chunk-boundary tests"
```

---

### Task 5: Parity with the classic parser

The test that makes "same numbers as before" provable. It extracts the classic `parseHealthXML` from `index.html` without editing that file (as `tests/js/summary_stats.test.mjs` does for the summary code) and compares outputs.

**Files:**
- Create: `web/src/lib/health/parity.test.ts`

**Interfaces:**
- Consumes: `standardFixtureXml`, `FIXTURE_NOW`, `toChunks`, `parseExport`. Reads `index.html` from the repo root (`../../../../index.html` relative to this file).

- [ ] **Step 1: Write the test** — `web/src/lib/health/parity.test.ts`

```ts
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FIXTURE_NOW, standardFixtureXml, toChunks } from './__fixtures__/exportFixture'
import { parseExport } from './parseExport'

const html = readFileSync(fileURLToPath(new URL('../../../../index.html', import.meta.url)), 'utf8')

function between(startMarker: string, endMarker: string): string {
  const start = html.indexOf(startMarker)
  const end = html.indexOf(endMarker, start)
  if (start < 0 || end < 0) throw new Error(`markers not found in index.html: ${startMarker}`)
  return html.slice(start, end)
}

// Pin "now" for the classic code's `new Date()` (retention cutoff) without touching index.html.
class FixedDate extends Date {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(FIXTURE_NOW.getTime())
    else super(...(args as [string]))
  }
}

const constants = between('const HEALTH_METRIC_MAP', 'const DEFAULT_LIFE_EVENTS')
const parser = between('function _getAttr', 'async function handleFileUpload')

type ClassicParse = (
  file: { text(): Promise<string> },
  onProgress: (pct: number, label: string) => void,
) => Promise<{ daily: unknown; summary: unknown }>

const classicParse = new Function(
  'Date',
  'getLifeEvents',
  'DATA_RETENTION_MONTHS',
  `${constants}\n${parser}\nreturn parseHealthXML;`,
)(FixedDate, () => [], 18) as ClassicParse

async function classic(xml: string) {
  return classicParse({ text: async () => xml }, () => {})
}

describe('parity with the classic parser (index.html)', () => {
  it('produces identical daily data and summary on the standard fixture', async () => {
    const xml = standardFixtureXml()
    const expected = await classic(xml)
    const actual = await parseExport(toChunks(xml, 64), { now: FIXTURE_NOW })
    expect(actual.daily).toEqual(expected.daily)
    expect(actual.summary).toEqual(expected.summary)
  })

  it('still agrees when the data is delivered one byte at a time', async () => {
    const xml = standardFixtureXml()
    const expected = await classic(xml)
    const actual = await parseExport(toChunks(xml, 1), { now: FIXTURE_NOW })
    expect(actual.daily).toEqual(expected.daily)
    expect(actual.summary).toEqual(expected.summary)
  })
})
```

- [ ] **Step 2: Run it**

Run: `npm --prefix web test -- src/lib/health/parity.test.ts`
Expected: PASS. This test is a guard rather than a RED test: the code under test already exists from Task 4.

If it FAILS, the new parser and the classic one disagree. Do not edit the test to match: find the difference in the diff output (most likely a day-creation or rounding rule), fix `parseExport.ts`, and re-run Task 4's tests too. If `new Function` cannot find a marker, the markers in `index.html` changed: report it instead of editing `index.html`.

- [ ] **Step 3: Run the full web checks and commit**

Run: `npm --prefix web test && npm --prefix web run lint && npm --prefix web run typecheck` -> Expected: exit 0.

```bash
git add web/src/lib/health/parity.test.ts
git commit -m "test(web): prove the new parser matches the classic parser's output"
```

---

### Task 6: `fileToChunks` — XML and ZIP input

**Files:**
- Create: `web/src/lib/health/__fixtures__/files.ts`, `web/src/lib/health/fileToChunks.ts`, `web/src/lib/health/fileToChunks.test.ts`

**Interfaces:**
- Consumes: `fflate` (`Unzip`, `UnzipInflate`, plus `zipSync`, `Zip`, `ZipDeflate`, `strToU8` in tests), `UploadError`.
- Produces (`fileToChunks.ts`): `interface ChunkableFile { name: string; size: number; stream(): ReadableStream<Uint8Array> }` (a real `File` satisfies it); `isHealthXmlEntry(name: string): boolean`; `fileToChunks(file: ChunkableFile, onSourceBytes: (cumulativeBytes: number) => void): AsyncGenerator<Uint8Array>`. Throws `UploadError`: `wrong-file-type` (name not `.zip`/`.xml`, case-insensitive), `zip-missing-export` (no matching entry), `corrupt-file` (ZIP ends before the entry completes, or fflate reports an error).
- Produces (`files.ts`): `chunkedFile(name, bytes, chunkSize): ChunkableFile`.
- `isHealthXmlEntry` is true for the first-found `.xml` entry whose name has no "cda" and is not macOS resource-fork junk (`__MACOSX/…` or a basename starting with `.`), false for directories.

- [ ] **Step 1: Write the helper** — `web/src/lib/health/__fixtures__/files.ts`

```ts
import type { ChunkableFile } from '../fileToChunks'

/** A File-like object whose stream() yields `bytes` in `chunkSize`-byte pieces. */
export function chunkedFile(name: string, bytes: Uint8Array, chunkSize: number): ChunkableFile {
  return {
    name,
    size: bytes.length,
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < bytes.length; i += chunkSize) {
            controller.enqueue(bytes.slice(i, i + chunkSize))
          }
          controller.close()
        },
      }),
  }
}
```

- [ ] **Step 2: Write the failing tests** — `web/src/lib/health/fileToChunks.test.ts`

```ts
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Zip, ZipDeflate, strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chunkedFile } from './__fixtures__/files'
import { fileToChunks, isHealthXmlEntry } from './fileToChunks'

afterEach(() => {
  vi.unstubAllGlobals()
})

async function collect(iterable: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder()
  let text = ''
  for await (const chunk of iterable) text += decoder.decode(chunk, { stream: true })
  return text + decoder.decode()
}

const XML = '<HealthData locale="en_US"><Record type="x"/></HealthData>'
const noop = () => {}

describe('isHealthXmlEntry', () => {
  it.each([
    ['apple_health_export/export.xml', true],
    ['export.xml', true],
    ['Export.XML', true],
    ['导出.xml', true],
    ['apple_health_export/export_cda.xml', false],
    ['导出_cda.xml', false],
    ['__MACOSX/apple_health_export/._export.xml', false],
    ['apple_health_export/._export.xml', false],
    ['apple_health_export/workout-routes/route.gpx', false],
    ['apple_health_export/', false],
  ])('%s -> %s', (name, expected) => {
    expect(isHealthXmlEntry(name)).toBe(expected)
  })
})

describe('fileToChunks with .xml files', () => {
  it('yields the file contents and reports bytes read', async () => {
    const bytes = strToU8(XML)
    const seen: number[] = []
    const text = await collect(fileToChunks(chunkedFile('export.xml', bytes, 7), (n) => seen.push(n)))
    expect(text).toBe(XML)
    expect(seen.at(-1)).toBe(bytes.length)
  })

  it('rejects other file types', async () => {
    const file = chunkedFile('notes.txt', strToU8('hello'), 10)
    await expect(collect(fileToChunks(file, noop))).rejects.toMatchObject({ code: 'wrong-file-type' })
  })
})

describe('fileToChunks with .zip files', () => {
  it('extracts export.xml and ignores export_cda.xml', async () => {
    const zip = zipSync({
      'apple_health_export/export_cda.xml': strToU8('<ClinicalDocument/>'),
      'apple_health_export/export.xml': strToU8(XML),
      'apple_health_export/workout-routes/route.gpx': strToU8('<gpx/>'),
    })
    for (const size of [1, 13, 4096]) {
      const text = await collect(fileToChunks(chunkedFile('export.zip', zip, size), noop))
      expect(text).toBe(XML)
    }
  })

  it('finds a localized export file name', async () => {
    const zip = zipSync({ '导出.xml': strToU8(XML), '导出_cda.xml': strToU8('<c/>') })
    expect(await collect(fileToChunks(chunkedFile('export.zip', zip, 50), noop))).toBe(XML)
  })

  it('ignores macOS resource-fork entries', async () => {
    const zip = zipSync({
      '__MACOSX/apple_health_export/._export.xml': strToU8('binary junk'),
      'apple_health_export/export.xml': strToU8(XML),
    })
    expect(await collect(fileToChunks(chunkedFile('export.zip', zip, 50), noop))).toBe(XML)
  })

  it('reports progress as bytes of the ZIP consumed', async () => {
    const zip = zipSync({ 'export.xml': strToU8(XML) })
    const seen: number[] = []
    await collect(fileToChunks(chunkedFile('export.zip', zip, 10), (n) => seen.push(n)))
    expect(seen.length).toBeGreaterThan(1)
    expect(seen.at(-1)).toBeLessThanOrEqual(zip.length)
  })

  it('rejects a ZIP with no export.xml', async () => {
    const zip = zipSync({ 'readme.txt': strToU8('hi'), 'a/route.gpx': strToU8('<gpx/>') })
    await expect(collect(fileToChunks(chunkedFile('export.zip', zip, 20), noop))).rejects.toMatchObject({
      code: 'zip-missing-export',
    })
  })

  it('rejects a truncated ZIP', async () => {
    const big = strToU8(XML + ' '.repeat(5000))
    const zip = zipSync({ 'export.xml': [big, { level: 0 }] })
    const truncated = zip.slice(0, Math.floor(zip.length / 2))
    await expect(collect(fileToChunks(chunkedFile('export.zip', truncated, 100), noop))).rejects.toMatchObject({
      code: 'corrupt-file',
    })
  })

  it('rejects bytes that are not a ZIP at all', async () => {
    const junk = strToU8('this is definitely not a zip file '.repeat(10))
    await expect(collect(fileToChunks(chunkedFile('export.zip', junk, 16), noop))).rejects.toMatchObject({
      code: expect.stringMatching(/zip-missing-export|corrupt-file/),
    })
  })

  it('handles a streamed ZIP whose sizes are in a data descriptor', async () => {
    const parts: Uint8Array[] = []
    const zip = new Zip((err, chunk) => {
      if (err) throw err
      parts.push(chunk)
    })
    const entry = new ZipDeflate('apple_health_export/export.xml')
    zip.add(entry)
    entry.push(strToU8(XML), true)
    zip.end()
    expect(parts.length).toBeGreaterThan(0)
    const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let offset = 0
    for (const p of parts) {
      bytes.set(p, offset)
      offset += p.length
    }
    expect(await collect(fileToChunks(chunkedFile('export.zip', bytes, 9), noop))).toBe(XML)
  })

  it.each(['zip64-seekable.zip', 'zip64-streamed.zip'])('handles the ZIP64 fixture %s', async (name) => {
    const bytes = new Uint8Array(
      readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url))),
    )
    const text = await collect(fileToChunks(chunkedFile('export.zip', bytes, 7), noop))
    expect(text).toContain('<HealthData')
    expect(text).toContain('HKQuantityTypeIdentifierStepCount')
  })

  it('makes no network calls', async () => {
    vi.stubGlobal('fetch', () => {
      throw new Error('network call while reading a file')
    })
    const zip = zipSync({ 'export.xml': strToU8(XML) })
    await expect(collect(fileToChunks(chunkedFile('export.zip', zip, 20), noop))).resolves.toBe(XML)
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npm --prefix web test -- src/lib/health/fileToChunks.test.ts`
Expected: FAIL, cannot resolve `./fileToChunks`.

- [ ] **Step 4: Implement** — `web/src/lib/health/fileToChunks.ts`

```ts
import { Unzip, UnzipInflate } from 'fflate'
import { UploadError } from './errors'

/** What the parser needs from a File; a real File satisfies it, tests pass small fakes. */
export interface ChunkableFile {
  name: string
  size: number
  stream(): ReadableStream<Uint8Array>
}

/**
 * True for the entry that holds the health records: the first `.xml` whose name has no "cda"
 * (so `export.xml` and its localized variants, but not `export_cda.xml`) and is not macOS
 * resource-fork junk. Entry sizes are unknown up front in a streamed ZIP, so this is name-only.
 */
export function isHealthXmlEntry(name: string): boolean {
  if (name.endsWith('/')) return false
  const lower = name.toLowerCase()
  if (lower.startsWith('__macosx/') || lower.includes('/__macosx/')) return false
  const base = lower.slice(lower.lastIndexOf('/') + 1)
  if (base.startsWith('.')) return false
  return base.endsWith('.xml') && !base.includes('cda')
}

async function* xmlChunks(
  file: ChunkableFile,
  onSourceBytes: (cumulativeBytes: number) => void,
): AsyncGenerator<Uint8Array> {
  const reader = file.stream().getReader()
  let total = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      total += value.length
      onSourceBytes(total)
      yield value
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

async function* zipChunks(
  file: ChunkableFile,
  onSourceBytes: (cumulativeBytes: number) => void,
): AsyncGenerator<Uint8Array> {
  const queue: Uint8Array[] = []
  const state = { selected: false, finished: false, failure: null as unknown }

  const unzip = new Unzip()
  unzip.register(UnzipInflate)
  unzip.onfile = (entry) => {
    if (state.selected || !isHealthXmlEntry(entry.name)) return // skipped entries are never started
    state.selected = true
    entry.ondata = (err, data, final) => {
      if (err) {
        state.failure = err
        return
      }
      if (data.length > 0) queue.push(data)
      if (final) state.finished = true
    }
    entry.start()
  }

  const reader = file.stream().getReader()
  let total = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      try {
        if (done) {
          unzip.push(new Uint8Array(0), true)
        } else {
          total += value.length
          unzip.push(value)
        }
      } catch (e) {
        throw new UploadError('corrupt-file', e instanceof Error ? e.message : String(e))
      }
      if (!done) onSourceBytes(total)
      if (state.failure) {
        throw new UploadError(
          'corrupt-file',
          state.failure instanceof Error ? state.failure.message : String(state.failure),
        )
      }
      while (queue.length > 0) {
        const next = queue.shift()
        if (next) yield next
      }
      if (state.finished || done) break
    }
    if (!state.selected) {
      throw new UploadError('zip-missing-export', 'No export.xml found in the ZIP')
    }
    if (!state.finished) {
      throw new UploadError('corrupt-file', 'The ZIP ends before export.xml is complete')
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

/**
 * The XML bytes of an Apple Health export, from `export.xml` directly or from inside
 * `export.zip`. `onSourceBytes` receives the cumulative bytes consumed from the file itself.
 */
export function fileToChunks(
  file: ChunkableFile,
  onSourceBytes: (cumulativeBytes: number) => void,
): AsyncGenerator<Uint8Array> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xml')) return xmlChunks(file, onSourceBytes)
  if (name.endsWith('.zip')) return zipChunks(file, onSourceBytes)
  return (async function* (): AsyncGenerator<Uint8Array> {
    throw new UploadError('wrong-file-type', `Unsupported file: ${file.name}`)
  })()
}
```

- [ ] **Step 5: Run to verify pass, then the full checks**

Run: `npm --prefix web test -- src/lib/health/fileToChunks.test.ts` -> Expected: all PASS.
Run: `npm --prefix web test && npm --prefix web run lint && npm --prefix web run typecheck` -> Expected: exit 0.

If the "truncated ZIP" test passes `zip-missing-export` instead of `corrupt-file`, the cut landed before the entry header: lengthen the payload in the test, not the production code. If the "not a ZIP at all" test hangs or fflate throws something other than the two codes, report it.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/health
git commit -m "feat(web): read export.xml or export.zip as a stream of XML chunks"
```

---

### Task 7: Repository — save under RLS and carry events over

**Files:**
- Create: `web/src/lib/health/repository.ts`, `web/src/lib/health/repository.test.ts`

**Interfaces:**
- Consumes: `SupabaseClient` type, `getSupabase` from `../supabase/client`, `UploadError`, `LifeEvent`, `HealthData`, `ParseResult`.
- Produces: `loadOwnEvents(client, userId): Promise<LifeEvent[]>` (filters `user_id = userId` only; never touches the demo row; select errors become `UploadError('save-failed')`); `saveOwnHealth(client, userId, parsed, now = new Date()): Promise<void>` (reads events, then upserts `{ user_id, data: { daily, summary, events, generated_at }, updated_at }` with `{ onConflict: 'user_id' }`; auth-style errors become `session-expired`, others `save-failed`); `saveForCurrentUser(parsed): Promise<void>` (uses `getSupabase()`: null -> `not-configured`; no session user -> `session-expired`).
- Auth-style error = PostgREST code `PGRST301` or `PGRST303`, or a message matching `/jwt/i`.

- [ ] **Step 1: Write the failing tests** — `web/src/lib/health/repository.test.ts`

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npm --prefix web test -- src/lib/health/repository.test.ts`
Expected: FAIL, cannot resolve `./repository`.

- [ ] **Step 3: Implement** — `web/src/lib/health/repository.ts`

```ts
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
  if (error) throw new UploadError('save-failed', error.message)
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
```

- [ ] **Step 4: Run to verify pass, then the full checks**

Run: `npm --prefix web test -- src/lib/health/repository.test.ts` -> Expected: all PASS.
Run: `npm --prefix web test && npm --prefix web run lint && npm --prefix web run typecheck` -> Expected: exit 0.

(The test imports `healthFixture` from `../../test/fixtures`; Task 8 adds `parseResultFixture` there, so this task does not touch that file.)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/health
git commit -m "feat(web): repository that saves a parsed export and keeps existing life events"
```

---

### Task 8: Worker, protocol, and the `useHealthUpload` hook

**Files:**
- Create: `web/src/lib/health/worker-protocol.ts`, `web/src/lib/health/parse.worker.ts`, `web/src/lib/health/createParseWorker.ts`, `web/src/lib/health/useHealthUpload.ts`, `web/src/lib/health/useHealthUpload.test.tsx`, `web/src/test/fakeWorker.ts`
- Modify: `web/vite.config.ts` (add `worker: { format: 'es' }`), `web/src/test/fixtures.ts` (add `parseResultFixture`)

**Interfaces:**
- Consumes: `parseExport`, `fileToChunks`, `UploadError`, `ParseResult`, `saveForCurrentUser`, TanStack Query's `useQueryClient`.
- Produces (`worker-protocol.ts`): `WorkerRequest = { type: 'parse'; file: File }`; `WorkerMessage = { type: 'progress'; fraction: number; recordsSeen: number } | { type: 'done'; result: ParseResult } | { type: 'error'; code: UploadErrorCode; message: string }`; `interface WorkerLike { postMessage(message: WorkerRequest): void; terminate(): void; onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null; onerror: ((event: ErrorEvent) => void) | null; onmessageerror: ((event: MessageEvent) => void) | null }`.
- Produces: `createParseWorker(): WorkerLike`.
- Produces (`useHealthUpload.ts`): `type UploadState` =
  `{ phase: 'idle' } | { phase: 'reading'; fileName: string; fraction: number; recordsSeen: number; startedAt: number } | { phase: 'parsed'; fileName: string; result: ParseResult } | { phase: 'saving'; fileName: string; result: ParseResult } | { phase: 'saved'; fileName: string; result: ParseResult } | { phase: 'error'; error: UploadErrorInfo; fileName?: string; result?: ParseResult }`;
  `interface HealthUploadOptions { createWorker?: () => WorkerLike; save?: (result: ParseResult) => Promise<void> }`;
  `useHealthUpload(options?): { state: UploadState; start(file: File): void; save(): Promise<void>; reset(): void }`.
- Produces (tests): `FakeWorker implements WorkerLike` with `posted`, `terminated`, `emit(message)`; `parseResultFixture(): ParseResult`.
- Behaviour: `start` validates (`.zip`/`.xml` by name, size > 0) and returns an error state **without** creating a worker; a second `start` while a parse is running is ignored; handlers ignore messages from a worker that is no longer current; worker `onerror`/`onmessageerror` -> `worker-failed`; `reset` (also used for Cancel and Choose another file) terminates the worker and forgets the parsed result; unmount terminates the worker; `save` is a no-op unless a parsed result exists and no save is in flight; a failed save keeps the result so `save` can be retried; a successful save marks `saved` and invalidates `['health']` queries.

- [ ] **Step 1: Test helpers**

`web/src/test/fakeWorker.ts`:
```ts
import type { WorkerLike, WorkerMessage, WorkerRequest } from '../lib/health/worker-protocol'

export class FakeWorker implements WorkerLike {
  posted: WorkerRequest[] = []
  terminated = false
  onmessage: WorkerLike['onmessage'] = null
  onerror: WorkerLike['onerror'] = null
  onmessageerror: WorkerLike['onmessageerror'] = null

  postMessage(message: WorkerRequest) {
    this.posted.push(message)
  }

  terminate() {
    this.terminated = true
  }

  emit(message: WorkerMessage) {
    this.onmessage?.({ data: message } as MessageEvent<WorkerMessage>)
  }
}
```

Append to `web/src/test/fixtures.ts` (and add `import type { HealthData, ParseResult } from '../lib/health/types'` replacing the existing type import):
```ts

export function parseResultFixture(): ParseResult {
  const h = healthFixture()
  return {
    daily: h.daily,
    summary: { ...h.summary, total_days: 120 },
    stats: {
      recordsSeen: 5000,
      recordsKept: 4000,
      firstDate: '2026-06-03',
      lastDate: '2026-09-30',
      bytesRead: 1_000_000,
      maxCarryBytes: 300,
    },
  }
}
```

- [ ] **Step 2: Write the failing hook tests** — `web/src/lib/health/useHealthUpload.test.tsx`

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FakeWorker } from '../../test/fakeWorker'
import { parseResultFixture } from '../../test/fixtures'
import { UploadError } from './errors'
import { useHealthUpload, type HealthUploadOptions } from './useHealthUpload'

const zipFile = (name = 'export.zip', content = 'x') => new File([content], name)

function setup(options: Partial<HealthUploadOptions> = {}) {
  const workers: FakeWorker[] = []
  const createWorker = vi.fn(() => {
    const w = new FakeWorker()
    workers.push(w)
    return w
  })
  const queryClient = new QueryClient()
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useHealthUpload({ createWorker, ...options }), { wrapper })
  return { ...hook, workers, createWorker, invalidate }
}

describe('reading', () => {
  it('posts the file to a worker and reports progress', () => {
    const { result, workers } = setup()
    const file = zipFile()
    act(() => result.current.start(file))
    expect(workers).toHaveLength(1)
    expect(workers[0].posted).toEqual([{ type: 'parse', file }])
    expect(result.current.state).toMatchObject({ phase: 'reading', fileName: 'export.zip', fraction: 0 })
    act(() => workers[0].emit({ type: 'progress', fraction: 0.4, recordsSeen: 1200 }))
    expect(result.current.state).toMatchObject({ phase: 'reading', fraction: 0.4, recordsSeen: 1200 })
  })

  it('moves to parsed with the result and stops the worker', () => {
    const { result, workers } = setup()
    act(() => result.current.start(zipFile()))
    const parsed = parseResultFixture()
    act(() => workers[0].emit({ type: 'done', result: parsed }))
    expect(result.current.state).toEqual({ phase: 'parsed', fileName: 'export.zip', result: parsed })
    expect(workers[0].terminated).toBe(true)
  })

  it('maps a worker error message to an error state', () => {
    const { result, workers } = setup()
    act(() => result.current.start(zipFile()))
    act(() => workers[0].emit({ type: 'error', code: 'corrupt-file', message: 'bad' }))
    expect(result.current.state).toEqual({ phase: 'error', error: { code: 'corrupt-file', message: 'bad' } })
    expect(workers[0].terminated).toBe(true)
  })

  it.each(['onerror', 'onmessageerror'] as const)('treats %s as worker-failed', (handler) => {
    const { result, workers } = setup()
    act(() => result.current.start(zipFile()))
    act(() => {
      workers[0][handler]?.({} as never)
    })
    expect(result.current.state).toMatchObject({ phase: 'error', error: { code: 'worker-failed' } })
  })

  it('rejects the wrong file type and empty files without creating a worker', () => {
    const { result, createWorker } = setup()
    act(() => result.current.start(zipFile('notes.txt')))
    expect(result.current.state).toMatchObject({ phase: 'error', error: { code: 'wrong-file-type' } })
    act(() => result.current.start(zipFile('export.zip', '')))
    expect(result.current.state).toMatchObject({ phase: 'error', error: { code: 'empty-file' } })
    expect(createWorker).not.toHaveBeenCalled()
  })

  it('accepts .ZIP and .XML in any case', () => {
    const { result, createWorker } = setup()
    act(() => result.current.start(zipFile('EXPORT.ZIP')))
    expect(createWorker).toHaveBeenCalledTimes(1)
    expect(result.current.state.phase).toBe('reading')
  })

  it('ignores a second file while a parse is running', () => {
    const { result, createWorker, workers } = setup()
    act(() => result.current.start(zipFile('a.zip')))
    act(() => result.current.start(zipFile('b.zip')))
    expect(createWorker).toHaveBeenCalledTimes(1)
    expect(result.current.state).toMatchObject({ phase: 'reading', fileName: 'a.zip' })
    expect(workers[0].posted).toHaveLength(1)
  })
})

describe('cancel and leaving the page', () => {
  it('reset terminates the worker, returns to idle and ignores late messages', () => {
    const { result, workers } = setup()
    act(() => result.current.start(zipFile()))
    act(() => result.current.reset())
    expect(workers[0].terminated).toBe(true)
    expect(result.current.state).toEqual({ phase: 'idle' })
    act(() => workers[0].emit({ type: 'done', result: parseResultFixture() }))
    expect(result.current.state).toEqual({ phase: 'idle' })
  })

  it('allows a new file after a reset', () => {
    const { result, createWorker } = setup()
    act(() => result.current.start(zipFile('a.zip')))
    act(() => result.current.reset())
    act(() => result.current.start(zipFile('b.zip')))
    expect(createWorker).toHaveBeenCalledTimes(2)
    expect(result.current.state).toMatchObject({ phase: 'reading', fileName: 'b.zip' })
  })

  it('terminates the worker when the component unmounts mid-parse', () => {
    const { result, workers, unmount } = setup()
    act(() => result.current.start(zipFile()))
    unmount()
    expect(workers[0].terminated).toBe(true)
  })
})

describe('saving', () => {
  function parsedHook(save: HealthUploadOptions['save']) {
    const ctx = setup({ save })
    act(() => ctx.result.current.start(zipFile()))
    act(() => ctx.workers[0].emit({ type: 'done', result: parseResultFixture() }))
    return ctx
  }

  it('saves the parsed result, marks saved and refreshes the health query', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result, invalidate } = parsedHook(save)
    await act(async () => {
      await result.current.save()
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(parseResultFixture())
    expect(result.current.state.phase).toBe('saved')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['health'] })
  })

  it('ignores a second Save click while a save is in flight', async () => {
    let release: () => void = () => {}
    const save = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    const { result } = parsedHook(save)
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.save()
    })
    expect(result.current.state.phase).toBe('saving')
    await act(async () => {
      await result.current.save()
    })
    expect(save).toHaveBeenCalledTimes(1)
    await act(async () => {
      release()
      await first
    })
    expect(result.current.state.phase).toBe('saved')
  })

  it('keeps the parsed result after a failed save so Retry does not re-parse', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new UploadError('save-failed', 'network'))
      .mockResolvedValueOnce(undefined)
    const { result, createWorker } = parsedHook(save)
    await act(async () => {
      await result.current.save()
    })
    expect(result.current.state).toMatchObject({
      phase: 'error',
      error: { code: 'save-failed' },
      result: parseResultFixture(),
    })
    await act(async () => {
      await result.current.save()
    })
    expect(save).toHaveBeenCalledTimes(2)
    expect(result.current.state.phase).toBe('saved')
    expect(createWorker).toHaveBeenCalledTimes(1)
  })

  it('preserves the error code of a session-expired save', async () => {
    const save = vi.fn().mockRejectedValue(new UploadError('session-expired', 'jwt'))
    const { result } = parsedHook(save)
    await act(async () => {
      await result.current.save()
    })
    expect(result.current.state).toMatchObject({ phase: 'error', error: { code: 'session-expired' } })
  })

  it('wraps unexpected save failures as save-failed', async () => {
    const save = vi.fn().mockRejectedValue(new Error('weird'))
    const { result } = parsedHook(save)
    await act(async () => {
      await result.current.save()
    })
    expect(result.current.state).toMatchObject({ phase: 'error', error: { code: 'save-failed', message: 'weird' } })
  })

  it('does nothing when there is no parsed result', async () => {
    const save = vi.fn()
    const { result } = setup({ save })
    await act(async () => {
      await result.current.save()
    })
    expect(save).not.toHaveBeenCalled()
    expect(result.current.state).toEqual({ phase: 'idle' })
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npm --prefix web test -- src/lib/health/useHealthUpload.test.tsx`
Expected: FAIL, cannot resolve `./useHealthUpload` (and `./worker-protocol`).

- [ ] **Step 4: Implement**

`web/src/lib/health/worker-protocol.ts`:
```ts
import type { UploadErrorCode } from './errors'
import type { ParseResult } from './types'

export type WorkerRequest = { type: 'parse'; file: File }

export type WorkerMessage =
  | { type: 'progress'; fraction: number; recordsSeen: number }
  | { type: 'done'; result: ParseResult }
  | { type: 'error'; code: UploadErrorCode; message: string }

/** The part of Worker the hook uses; tests substitute a fake. */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void
  terminate(): void
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
}
```

`web/src/lib/health/parse.worker.ts`:
```ts
import { UploadError } from './errors'
import { fileToChunks } from './fileToChunks'
import { parseExport } from './parseExport'
import type { WorkerMessage, WorkerRequest } from './worker-protocol'

// Typed locally: the DOM lib (used by the rest of the app) and the WebWorker lib cannot be mixed.
interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: WorkerMessage): void
}
const scope = self as unknown as WorkerScope

const PROGRESS_INTERVAL_MS = 100

async function run(file: File): Promise<void> {
  let sourceBytes = 0
  let lastPost = 0
  const progress = (recordsSeen: number) => {
    const now = performance.now()
    if (now - lastPost < PROGRESS_INTERVAL_MS) return
    lastPost = now
    const fraction = file.size > 0 ? Math.min(1, sourceBytes / file.size) : 0
    scope.postMessage({ type: 'progress', fraction, recordsSeen })
  }
  try {
    const chunks = fileToChunks(file, (bytes) => {
      sourceBytes = bytes
    })
    const result = await parseExport(chunks, { onProgress: ({ recordsSeen }) => progress(recordsSeen) })
    scope.postMessage({ type: 'done', result })
  } catch (e) {
    const err = e instanceof UploadError ? e : new UploadError('corrupt-file', e instanceof Error ? e.message : String(e))
    scope.postMessage({ type: 'error', code: err.code, message: err.message })
  }
}

scope.onmessage = (event) => {
  void run(event.data.file)
}
```

`web/src/lib/health/createParseWorker.ts`:
```ts
import type { WorkerLike } from './worker-protocol'

export function createParseWorker(): WorkerLike {
  return new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' })
}
```

`web/src/lib/health/useHealthUpload.ts`:
```ts
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createParseWorker } from './createParseWorker'
import { UploadError, type UploadErrorInfo } from './errors'
import { saveForCurrentUser } from './repository'
import type { ParseResult } from './types'
import type { WorkerLike } from './worker-protocol'

export type UploadState =
  | { phase: 'idle' }
  | { phase: 'reading'; fileName: string; fraction: number; recordsSeen: number; startedAt: number }
  | { phase: 'parsed'; fileName: string; result: ParseResult }
  | { phase: 'saving'; fileName: string; result: ParseResult }
  | { phase: 'saved'; fileName: string; result: ParseResult }
  | { phase: 'error'; error: UploadErrorInfo; fileName?: string; result?: ParseResult }

export interface HealthUploadOptions {
  createWorker?: () => WorkerLike
  save?: (result: ParseResult) => Promise<void>
}

function validateFile(file: File): UploadErrorInfo | null {
  if (!/\.(zip|xml)$/i.test(file.name)) {
    return { code: 'wrong-file-type', message: `Unsupported file: ${file.name}` }
  }
  if (file.size === 0) return { code: 'empty-file', message: `${file.name} is empty` }
  return null
}

function toErrorInfo(e: unknown, fallback: UploadErrorInfo['code']): UploadErrorInfo {
  if (e instanceof UploadError) return { code: e.code, message: e.message }
  return { code: fallback, message: e instanceof Error ? e.message : String(e) }
}

export function useHealthUpload({
  createWorker = createParseWorker,
  save = saveForCurrentUser,
}: HealthUploadOptions = {}) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<UploadState>({ phase: 'idle' })
  const workerRef = useRef<WorkerLike | null>(null)
  const parsedRef = useRef<{ fileName: string; result: ParseResult } | null>(null)
  const savingRef = useRef(false)
  const mountedRef = useRef(true)

  const stopWorker = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      stopWorker()
    }
  }, [stopWorker])

  const start = useCallback(
    (file: File) => {
      if (workerRef.current) return // a parse is already running
      const invalid = validateFile(file)
      if (invalid) {
        setState({ phase: 'error', error: invalid })
        return
      }
      parsedRef.current = null
      const worker = createWorker()
      workerRef.current = worker
      const fail = (error: UploadErrorInfo) => {
        if (workerRef.current !== worker) return
        stopWorker()
        setState({ phase: 'error', error })
      }
      worker.onmessage = (event) => {
        if (workerRef.current !== worker) return // stale worker (cancelled or replaced)
        const message = event.data
        if (message.type === 'progress') {
          setState((s) =>
            s.phase === 'reading' ? { ...s, fraction: message.fraction, recordsSeen: message.recordsSeen } : s,
          )
        } else if (message.type === 'done') {
          stopWorker()
          parsedRef.current = { fileName: file.name, result: message.result }
          setState({ phase: 'parsed', fileName: file.name, result: message.result })
        } else {
          fail({ code: message.code, message: message.message })
        }
      }
      worker.onerror = () => fail({ code: 'worker-failed', message: 'The parser crashed' })
      worker.onmessageerror = () => fail({ code: 'worker-failed', message: 'The parser sent an unreadable message' })
      setState({ phase: 'reading', fileName: file.name, fraction: 0, recordsSeen: 0, startedAt: Date.now() })
      worker.postMessage({ type: 'parse', file })
    },
    [createWorker, stopWorker],
  )

  const reset = useCallback(() => {
    stopWorker()
    parsedRef.current = null
    setState({ phase: 'idle' })
  }, [stopWorker])

  const saveParsed = useCallback(async () => {
    const parsed = parsedRef.current
    if (!parsed || savingRef.current) return
    savingRef.current = true
    setState({ phase: 'saving', ...parsed })
    try {
      await save(parsed.result)
      void queryClient.invalidateQueries({ queryKey: ['health'] })
      if (mountedRef.current) setState({ phase: 'saved', ...parsed })
    } catch (e) {
      if (mountedRef.current) setState({ phase: 'error', error: toErrorInfo(e, 'save-failed'), ...parsed })
    } finally {
      savingRef.current = false
    }
  }, [queryClient, save])

  return { state, start, save: saveParsed, reset }
}
```

In `web/vite.config.ts`, add a top-level `worker` option next to `plugins` so the module worker builds as ES:
```ts
  worker: { format: 'es' },
```

- [ ] **Step 5: Run to verify pass, then the full checks including the build**

Run: `npm --prefix web test -- src/lib/health/useHealthUpload.test.tsx` -> Expected: all PASS.
Run: `npm --prefix web test && npm --prefix web run lint && npm --prefix web run typecheck` -> Expected: exit 0.
Run: `npm --prefix web run build` -> Expected: exit 0. (The worker is only bundled once the upload page imports the hook, in Task 10, so the worker output is verified there.)

If `createParseWorker`'s `return new Worker(...)` fails typecheck because `Worker` is not assignable to `WorkerLike`, add `as unknown as WorkerLike` with a one-line comment and record it in the report; do not change the interface.

- [ ] **Step 6: Commit**

```bash
git add web/vite.config.ts web/src
git commit -m "feat(web): parse worker and useHealthUpload hook with cancel, retry and single-flight save"
```

---

### Task 9: Upload UI components

All components are presentational; the page (Task 10) composes them.

**Files:**
- Create under `web/src/features/upload/`: `errorMessages.ts`, `preview.ts`, `Sparkline.tsx`, `ExportGuide.tsx`, `DropZone.tsx`, `ReadingProgress.tsx`, `PreviewPanel.tsx`, `ErrorPanel.tsx` and a test file for each (`errorMessages.test.ts`, `preview.test.ts`, `Sparkline.test.tsx`, `ExportGuide.test.tsx`, `DropZone.test.tsx`, `ReadingProgress.test.tsx`, `PreviewPanel.test.tsx`, `ErrorPanel.test.tsx`)
- Modify: `web/src/styles.css` (append)

**Interfaces:**
- Consumes: `UploadErrorCode`, `UPLOAD_ERROR_CODES`, `UploadErrorInfo`, `ParseResult`.
- Produces:
  - `describeUploadError(code): { title: string; hint: string; retry: boolean }` (`retry` is true only for `save-failed`).
  - `buildPreview(result): PreviewModel` where `PreviewModel = { days: number; range: string; cards: { label: string; value: string }[]; missing: string[]; steps: (number | null)[]; sleep: (number | null)[] }`. Cards in order: `Average steps` (`3,750`), `Average sleep` (`8 h`), `Average resting HR` (`58 bpm`), `Average HRV` (`45 ms`); `–` for null. `range` = `"<first> to <last>"` or `–`. `missing` = names (`steps`, `sleep`, `resting heart rate`, `HRV`) whose average is null.
  - `toPoints(values, width, height): string | null`; `<Sparkline values label />` (an `svg` with `role="img"` and `aria-label={label}`, or the text `<label>: not enough data` when fewer than 2 numeric values).
  - `<ExportGuide />`; `<DropZone onFile disabled? />` (file input labelled by the text "Choose your export", `accept=".zip,.xml,application/zip,text/xml,application/xml"`, also handles drop events); `<ReadingProgress fileName fraction recordsSeen startedAt onCancel />` (`role="progressbar"` with `aria-valuenow`); `<PreviewPanel result existing saving saveDisabledReason onSave onChooseAnother />` where `existing: { days: number; lastDate: string | null } | null`; `<ErrorPanel error onRetry? onReset />` (`role="alert"`).

- [ ] **Step 1: Write the failing tests**

`errorMessages.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { UPLOAD_ERROR_CODES } from '../../lib/health/errors'
import { describeUploadError } from './errorMessages'

describe('describeUploadError', () => {
  it.each(UPLOAD_ERROR_CODES)('has a title and hint for %s', (code) => {
    const text = describeUploadError(code)
    expect(text.title.length).toBeGreaterThan(0)
    expect(text.hint.length).toBeGreaterThan(0)
  })

  it('offers retry only for save-failed', () => {
    const retryable = UPLOAD_ERROR_CODES.filter((code) => describeUploadError(code).retry)
    expect(retryable).toEqual(['save-failed'])
  })
})
```

`preview.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseResultFixture } from '../../test/fixtures'
import { buildPreview } from './preview'

function result() {
  const r = parseResultFixture()
  r.summary = {
    avg_steps: 3750,
    avg_sleep_hours: 8,
    avg_resting_hr: 58,
    avg_hrv: 45,
    best_sleep: 8,
    worst_sleep: 8,
    best_steps_day: '2026-01-11',
    total_days: 5,
  }
  r.stats.firstDate = '2026-01-10'
  r.stats.lastDate = '2026-01-14'
  return r
}

describe('buildPreview', () => {
  it('formats the cards, range and day count', () => {
    const p = buildPreview(result())
    expect(p.days).toBe(5)
    expect(p.range).toBe('2026-01-10 to 2026-01-14')
    expect(p.cards).toEqual([
      { label: 'Average steps', value: '3,750' },
      { label: 'Average sleep', value: '8 h' },
      { label: 'Average resting HR', value: '58 bpm' },
      { label: 'Average HRV', value: '45 ms' },
    ])
    expect(p.missing).toEqual([])
  })

  it('names the metrics that are missing and shows a dash', () => {
    const r = result()
    r.summary.avg_sleep_hours = null
    r.summary.avg_hrv = null
    const p = buildPreview(r)
    expect(p.missing).toEqual(['sleep', 'HRV'])
    expect(p.cards.find((c) => c.label === 'Average sleep')?.value).toBe('–')
    expect(p.cards.find((c) => c.label === 'Average HRV')?.value).toBe('–')
  })

  it('returns the daily series in date order, with nulls kept', () => {
    const r = result()
    r.daily = {
      '2026-01-12': { ...r.daily['2026-09-30'], date: '2026-01-12', steps: 30, sleep_hours: null },
      '2026-01-10': { ...r.daily['2026-09-30'], date: '2026-01-10', steps: 10, sleep_hours: 7 },
    }
    const p = buildPreview(r)
    expect(p.steps).toEqual([10, 30])
    expect(p.sleep).toEqual([7, null])
  })

  it('shows a dash for the range when dates are unknown', () => {
    const r = result()
    r.stats.firstDate = null
    expect(buildPreview(r).range).toBe('–')
  })
})
```

`Sparkline.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Sparkline, toPoints } from './Sparkline'

describe('toPoints', () => {
  it('returns null with fewer than two numeric values', () => {
    expect(toPoints([], 100, 20)).toBeNull()
    expect(toPoints([null, 5, null], 100, 20)).toBeNull()
  })

  it('spans the full width and keeps the highest value at the top', () => {
    const points = toPoints([0, 10], 100, 20)
    expect(points).toBe('0.0,18.0 100.0,2.0')
  })

  it('leaves gaps in x for null values', () => {
    const points = toPoints([1, null, 3], 100, 20)
    expect(points?.split(' ').map((p) => p.split(',')[0])).toEqual(['0.0', '100.0'])
  })
})

describe('Sparkline', () => {
  it('renders an accessible svg', () => {
    render(<Sparkline values={[1, 2, 3]} label="Steps trend" />)
    expect(screen.getByRole('img', { name: 'Steps trend' })).toBeInTheDocument()
  })

  it('says so when there is not enough data', () => {
    render(<Sparkline values={[1]} label="Sleep trend" />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Sleep trend: not enough data')).toBeInTheDocument()
  })
})
```

`ExportGuide.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ExportGuide } from './ExportGuide'

describe('ExportGuide', () => {
  it('lists the export steps in order', () => {
    render(<ExportGuide />)
    const steps = screen.getAllByRole('listitem')
    expect(steps).toHaveLength(4)
    expect(steps[0]).toHaveTextContent(/Health app/)
    expect(steps[1]).toHaveTextContent(/Export All Health Data/)
    expect(steps[2]).toHaveTextContent(/Move the ZIP/)
  })

  it('tells users they do not need to unzip', () => {
    render(<ExportGuide />)
    expect(screen.getByText(/don't need to unzip/i)).toBeInTheDocument()
  })
})
```

`DropZone.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DropZone } from './DropZone'

const zip = () => new File(['x'], 'export.zip', { type: 'application/zip' })

describe('DropZone', () => {
  it('has a labelled file input that accepts zip and xml', () => {
    render(<DropZone onFile={() => {}} />)
    const input = screen.getByLabelText(/choose your export/i)
    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAttribute('accept', expect.stringContaining('.zip'))
    expect(input).toHaveAttribute('accept', expect.stringContaining('.xml'))
  })

  it('passes a chosen file to onFile', async () => {
    const onFile = vi.fn()
    render(<DropZone onFile={onFile} />)
    const file = zip()
    await userEvent.upload(screen.getByLabelText(/choose your export/i), file)
    expect(onFile).toHaveBeenCalledWith(file)
  })

  it('passes a dropped file to onFile', () => {
    const onFile = vi.fn()
    render(<DropZone onFile={onFile} />)
    const file = zip()
    fireEvent.drop(screen.getByText(/choose your export/i).closest('label') as HTMLElement, {
      dataTransfer: { files: [file] },
    })
    expect(onFile).toHaveBeenCalledWith(file)
  })

  it('ignores drops and disables the input when disabled', () => {
    const onFile = vi.fn()
    render(<DropZone onFile={onFile} disabled />)
    expect(screen.getByLabelText(/choose your export/i)).toBeDisabled()
    fireEvent.drop(screen.getByText(/choose your export/i).closest('label') as HTMLElement, {
      dataTransfer: { files: [zip()] },
    })
    expect(onFile).not.toHaveBeenCalled()
  })

  it('states that nothing is sent until Save', () => {
    render(<DropZone onFile={() => {}} />)
    expect(screen.getByText(/nothing is sent until you press save/i)).toBeInTheDocument()
  })
})
```

`ReadingProgress.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ReadingProgress } from './ReadingProgress'

describe('ReadingProgress', () => {
  it('shows a progressbar with the percentage, file name and record count', () => {
    render(
      <ReadingProgress
        fileName="export.zip"
        fraction={0.426}
        recordsSeen={1234567}
        startedAt={Date.now() - 5000}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '43')
    expect(screen.getByText(/export\.zip/)).toBeInTheDocument()
    expect(screen.getByText(/1,234,567 records/)).toBeInTheDocument()
    expect(screen.getByText(/5s elapsed/)).toBeInTheDocument()
  })

  it('cancels', async () => {
    const onCancel = vi.fn()
    render(
      <ReadingProgress fileName="a.zip" fraction={0} recordsSeen={0} startedAt={Date.now()} onCancel={onCancel} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
```

`PreviewPanel.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { parseResultFixture } from '../../test/fixtures'
import { PreviewPanel } from './PreviewPanel'

function props(overrides: Partial<Parameters<typeof PreviewPanel>[0]> = {}) {
  return {
    result: parseResultFixture(),
    existing: null,
    saving: false,
    saveDisabledReason: null,
    onSave: vi.fn(),
    onChooseAnother: vi.fn(),
    ...overrides,
  }
}

describe('PreviewPanel', () => {
  it('shows what was found', () => {
    render(<PreviewPanel {...props()} />)
    expect(screen.getByText(/120 days/)).toBeInTheDocument()
    expect(screen.getByText('2026-06-03 to 2026-09-30')).toBeInTheDocument()
    expect(screen.getByText('Average steps')).toBeInTheDocument()
    expect(screen.getByText('Nothing has been saved yet.')).toBeInTheDocument()
  })

  it('names missing metrics', () => {
    const p = props()
    p.result.summary.avg_sleep_hours = null
    render(<PreviewPanel {...p} />)
    expect(screen.getByText('No sleep data found in this export.')).toBeInTheDocument()
  })

  it('warns that saving replaces existing data and keeps events', () => {
    render(<PreviewPanel {...props({ existing: { days: 300, lastDate: '2026-09-01' } })} />)
    expect(
      screen.getByText(
        'This replaces your current data (300 days, through 2026-09-01). Your life events are kept.',
      ),
    ).toBeInTheDocument()
  })

  it('does not show the replace warning for new users', () => {
    render(<PreviewPanel {...props({ existing: null })} />)
    expect(screen.queryByText(/replaces your current data/)).not.toBeInTheDocument()
  })

  it('saves and lets the user choose another file', async () => {
    const p = props()
    render(<PreviewPanel {...p} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save to my account' }))
    expect(p.onSave).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Choose a different file' }))
    expect(p.onChooseAnother).toHaveBeenCalledTimes(1)
  })

  it('disables Save while saving', () => {
    render(<PreviewPanel {...props({ saving: true })} />)
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  })

  it('disables Save with an explanation when saving is unavailable', () => {
    render(<PreviewPanel {...props({ saveDisabledReason: "Saving isn't available in local mode." })} />)
    expect(screen.getByRole('button', { name: 'Save to my account' })).toBeDisabled()
    expect(screen.getByText("Saving isn't available in local mode.")).toBeInTheDocument()
  })

  it('draws the steps and sleep sparklines', () => {
    render(<PreviewPanel {...props()} />)
    // The fixture has a single day, so there is not enough data to draw either line.
    expect(screen.getByText('Steps trend: not enough data')).toBeInTheDocument()
    expect(screen.getByText('Sleep trend: not enough data')).toBeInTheDocument()
  })
})
```

`ErrorPanel.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ErrorPanel } from './ErrorPanel'

describe('ErrorPanel', () => {
  it('announces the problem with a specific message and a way out', async () => {
    const onReset = vi.fn()
    render(<ErrorPanel error={{ code: 'zip-missing-export', message: 'x' }} onReset={onReset} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/export\.xml/)
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Choose a different file' }))
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('offers Try again only for retryable errors', async () => {
    const onRetry = vi.fn()
    render(<ErrorPanel error={{ code: 'save-failed', message: 'x' }} onRetry={onRetry} onReset={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('does not offer Try again when no retry handler is given', () => {
    render(<ErrorPanel error={{ code: 'save-failed', message: 'x' }} onReset={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm --prefix web test -- src/features/upload`
Expected: FAIL, unresolved imports for every component.

- [ ] **Step 3: Implement**

`errorMessages.ts`:
```ts
import type { UploadErrorCode } from '../../lib/health/errors'

export interface ErrorText {
  title: string
  hint: string
  retry: boolean
}

const MESSAGES: Record<UploadErrorCode, ErrorText> = {
  'wrong-file-type': {
    title: "That isn't an Apple Health export",
    hint: "Choose Apple's export.zip (or the export.xml inside it).",
    retry: false,
  },
  'empty-file': {
    title: 'That file is empty',
    hint: 'Try exporting again from the Health app and make sure the transfer finished.',
    retry: false,
  },
  'zip-missing-export': {
    title: "We couldn't find export.xml in that ZIP",
    hint: 'Make sure it is the ZIP the Health app exported, not another archive.',
    retry: false,
  },
  'not-health-export': {
    title: "That doesn't look like an Apple Health export",
    hint: 'The file has no Health data in it. Choose the export.xml from your Health export.',
    retry: false,
  },
  'corrupt-file': {
    title: 'The file looks damaged or incomplete',
    hint: 'Export again from the Health app and make sure the transfer finished before uploading.',
    retry: false,
  },
  'no-usable-records': {
    title: 'No usable data found',
    hint: 'We found no steps, sleep, heart-rate or similar data from the last 18 months in this export.',
    retry: false,
  },
  'worker-failed': {
    title: 'Something went wrong while reading the file',
    hint: 'It may be too large for this browser. Try again, or use a desktop browser.',
    retry: false,
  },
  'save-failed': {
    title: "We couldn't save your data",
    hint: 'Check your connection and try again. Your file does not need to be read again.',
    retry: true,
  },
  'session-expired': {
    title: 'Your session expired',
    hint: 'Sign in again, then upload your export again.',
    retry: false,
  },
  'not-configured': {
    title: "Saving isn't available here",
    hint: 'This environment has no database configured.',
    retry: false,
  },
}

export function describeUploadError(code: UploadErrorCode): ErrorText {
  return MESSAGES[code]
}
```

`preview.ts`:
```ts
import type { ParseResult } from '../../lib/health/types'

export interface PreviewCard {
  label: string
  value: string
}

export interface PreviewModel {
  days: number
  range: string
  cards: PreviewCard[]
  missing: string[]
  steps: (number | null)[]
  sleep: (number | null)[]
}

const fmt = (n: number | null, digits = 0): string =>
  n === null ? '–' : n.toLocaleString('en-US', { maximumFractionDigits: digits })

const withUnit = (n: number | null, unit: string, digits = 0): string =>
  n === null ? '–' : `${fmt(n, digits)} ${unit}`

export function buildPreview(result: ParseResult): PreviewModel {
  const { summary, stats, daily } = result
  const entries = Object.keys(daily)
    .sort()
    .map((date) => daily[date])
  const missing = (
    [
      ['steps', summary.avg_steps],
      ['sleep', summary.avg_sleep_hours],
      ['resting heart rate', summary.avg_resting_hr],
      ['HRV', summary.avg_hrv],
    ] as const
  )
    .filter(([, value]) => value === null)
    .map(([name]) => name)
  return {
    days: summary.total_days,
    range: stats.firstDate && stats.lastDate ? `${stats.firstDate} to ${stats.lastDate}` : '–',
    cards: [
      { label: 'Average steps', value: fmt(summary.avg_steps) },
      { label: 'Average sleep', value: withUnit(summary.avg_sleep_hours, 'h', 1) },
      { label: 'Average resting HR', value: withUnit(summary.avg_resting_hr, 'bpm') },
      { label: 'Average HRV', value: withUnit(summary.avg_hrv, 'ms') },
    ],
    missing,
    steps: entries.map((e) => e.steps),
    sleep: entries.map((e) => e.sleep_hours),
  }
}
```

`Sparkline.tsx`:
```tsx
/** SVG polyline points for the non-null values, spread evenly over `width` by position. */
export function toPoints(values: (number | null)[], width: number, height: number): string | null {
  const present = values.flatMap((v, i) => (v === null ? [] : [{ v, i }]))
  if (present.length < 2) return null
  const nums = present.map((p) => p.v)
  const min = Math.min(...nums)
  const span = Math.max(...nums) - min || 1
  const lastIndex = values.length - 1
  return present
    .map(({ v, i }) => {
      const x = (i / lastIndex) * width
      const y = height - 2 - ((v - min) / span) * (height - 4)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

const WIDTH = 160
const HEIGHT = 36

export function Sparkline({ values, label }: { values: (number | null)[]; label: string }) {
  const points = toPoints(values, WIDTH, HEIGHT)
  if (points === null) return <p className="muted">{label}: not enough data</p>
  return (
    <svg
      role="img"
      aria-label={label}
      className="sparkline"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
    >
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
    </svg>
  )
}
```

`ExportGuide.tsx`:
```tsx
export function ExportGuide() {
  return (
    <section aria-labelledby="guide-title">
      <h2 id="guide-title">How to export your Apple Health data</h2>
      <ol className="guide-steps">
        <li>
          Open the <strong>Health</strong> app on your iPhone and tap your <strong>profile picture</strong>.
        </li>
        <li>
          Scroll down and tap <strong>Export All Health Data</strong>, then wait. This can take a few minutes.
        </li>
        <li>Move the ZIP file to this computer (AirDrop, email, or Files).</li>
        <li>Drop it below. You don't need to unzip it.</li>
      </ol>
    </section>
  )
}
```

`DropZone.tsx`:
```tsx
import { useId, useState } from 'react'

export function DropZone({ onFile, disabled = false }: { onFile: (file: File) => void; disabled?: boolean }) {
  const [dragging, setDragging] = useState(false)
  const inputId = useId()

  function pick(files: ArrayLike<File> | null | undefined) {
    const file = files?.[0]
    if (file) onFile(file)
  }

  const classes = ['dropzone', dragging ? 'dragging' : '', disabled ? 'disabled' : ''].filter(Boolean).join(' ')

  return (
    <label
      htmlFor={inputId}
      className={classes}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (!disabled) pick(e.dataTransfer.files)
      }}
    >
      <span className="dropzone-title">Choose your export</span>
      <span className="muted">or drop export.zip (or export.xml) here</span>
      <input
        id={inputId}
        type="file"
        accept=".zip,.xml,application/zip,text/xml,application/xml"
        disabled={disabled}
        onChange={(e) => {
          pick(e.target.files)
          e.target.value = ''
        }}
      />
      <span className="muted">Your file is read in your browser. Nothing is sent until you press Save.</span>
    </label>
  )
}
```

`ReadingProgress.tsx`:
```tsx
import { useEffect, useState } from 'react'

export function ReadingProgress({
  fileName,
  fraction,
  recordsSeen,
  startedAt,
  onCancel,
}: {
  fileName: string
  fraction: number
  recordsSeen: number
  startedAt: number
  onCancel: () => void
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100)
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))

  return (
    <section aria-live="polite">
      <h2>Reading {fileName}</h2>
      <div
        role="progressbar"
        aria-label="Reading progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="progress"
      >
        <div className="progress-bar" style={{ width: `${percent}%` }} />
      </div>
      <p className="muted">
        {percent}% · {recordsSeen.toLocaleString('en-US')} records · {seconds}s elapsed
      </p>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </section>
  )
}
```

`PreviewPanel.tsx`:
```tsx
import type { ParseResult } from '../../lib/health/types'
import { buildPreview } from './preview'
import { Sparkline } from './Sparkline'

export function PreviewPanel({
  result,
  existing,
  saving,
  saveDisabledReason,
  onSave,
  onChooseAnother,
}: {
  result: ParseResult
  existing: { days: number; lastDate: string | null } | null
  saving: boolean
  saveDisabledReason: string | null
  onSave: () => void
  onChooseAnother: () => void
}) {
  const preview = buildPreview(result)
  return (
    <section>
      <h2>Here's what we found</h2>
      <p>
        {preview.days} days of data · <span>{preview.range}</span>
      </p>
      <ul className="cards">
        {preview.cards.map((card) => (
          <li key={card.label}>
            <span className="muted">{card.label}</span>
            <strong>{card.value}</strong>
          </li>
        ))}
      </ul>
      {preview.missing.map((name) => (
        <p key={name} className="muted">
          No {name} data found in this export.
        </p>
      ))}
      <div className="sparklines">
        <Sparkline values={preview.steps} label="Steps trend" />
        <Sparkline values={preview.sleep} label="Sleep trend" />
      </div>
      {existing && (
        <p role="note" className="demo-banner">
          This replaces your current data ({existing.days} days
          {existing.lastDate ? `, through ${existing.lastDate}` : ''}). Your life events are kept.
        </p>
      )}
      <p className="muted">Nothing has been saved yet.</p>
      {saveDisabledReason && <p className="muted">{saveDisabledReason}</p>}
      <div className="actions">
        <button type="button" onClick={onSave} disabled={saving || saveDisabledReason !== null}>
          {saving ? 'Saving…' : 'Save to my account'}
        </button>
        <button type="button" onClick={onChooseAnother} disabled={saving}>
          Choose a different file
        </button>
      </div>
    </section>
  )
}
```

`ErrorPanel.tsx`:
```tsx
import type { UploadErrorInfo } from '../../lib/health/errors'
import { describeUploadError } from './errorMessages'

export function ErrorPanel({
  error,
  onRetry,
  onReset,
}: {
  error: UploadErrorInfo
  onRetry?: () => void
  onReset: () => void
}) {
  const text = describeUploadError(error.code)
  return (
    <div role="alert" className="upload-error">
      <h2>{text.title}</h2>
      <p>{text.hint}</p>
      <div className="actions">
        {text.retry && onRetry && (
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        )}
        <button type="button" onClick={onReset}>
          Choose a different file
        </button>
      </div>
    </div>
  )
}
```

Append to `web/src/styles.css`:
```css

/* Upload flow */
.muted {
  color: var(--muted);
}

.guide-steps {
  padding-left: 20px;
  display: grid;
  gap: 8px;
}

.dropzone {
  display: grid;
  gap: 6px;
  justify-items: center;
  padding: 32px 16px;
  text-align: center;
  border: 2px dashed var(--line);
  border-radius: 8px;
  cursor: pointer;
}

.dropzone.dragging,
.dropzone:focus-within {
  border-color: var(--accent);
}

.dropzone.disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.dropzone-title {
  font-weight: 600;
}

.dropzone input[type='file'] {
  max-width: 100%;
}

.progress {
  height: 10px;
  border-radius: 5px;
  background: var(--line);
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: var(--accent);
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
  padding: 0;
  list-style: none;
}

.cards li {
  display: grid;
  gap: 2px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
}

.sparklines {
  display: grid;
  gap: 8px;
  color: var(--accent);
}

.sparkline {
  width: 100%;
  height: 48px;
}

.upload-error {
  padding: 12px 16px;
  border: 1px solid var(--line);
  border-radius: 8px;
}
```

- [ ] **Step 4: Run to verify pass, then the full checks**

Run: `npm --prefix web test -- src/features/upload` -> Expected: all PASS.
Run: `npm --prefix web test && npm --prefix web run lint && npm --prefix web run typecheck` -> Expected: exit 0.

If `userEvent.upload` refuses the file because of the `accept` attribute, the test file has the wrong extension or type: fix the test file, not the `accept` list.

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "feat(web): upload screens: guide, drop zone, progress, preview and error panels"
```

---

### Task 10: The upload page and app wiring

**Files:**
- Create: `web/src/lib/health/useHealthQuery.ts`, `web/src/features/upload/UploadPage.tsx`, `web/src/features/upload/UploadPage.test.tsx`
- Modify: `web/src/features/dashboard/DashboardPage.tsx`, `web/src/features/dashboard/DashboardPage.test.tsx`, `web/src/app/AppRoutes.tsx`, `web/src/app/AppRoutes.test.tsx`, `web/src/app/Shell.tsx`, `web/src/app/Shell.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 3-9, `useAuth`, `getHealth`, `renderAt`, `authValue`, `stubFetch`, `healthFixture`, `parseResultFixture`, `FakeWorker`.
- Produces: `useHealthQuery()` (`useQuery` with key `['health', email]` calling `getHealth(getToken)`, shared by the dashboard and the upload page); `ownDataSummary(data)` (exported from `UploadPage.tsx`: `null` for no data or demo data, otherwise `{ days: data.summary.total_days, lastDate: <latest key of data.daily> | null }`); `<UploadPage {...HealthUploadOptions} />` (options only for tests); route `/upload`; nav link "Upload"; the dashboard empty state and sample-data banner link to `/upload`.
- Upload page states: idle -> guide + drop zone; reading -> progress; parsed/saving -> preview; saved -> "Your data is saved" + link "Go to dashboard"; error -> error panel (Retry shown only when a parsed result exists). When auth status is `unconfigured`, the preview's Save is disabled with the reason "Saving isn't available in local mode (Supabase isn't configured)."

- [ ] **Step 1: Write the failing tests**

`web/src/features/upload/UploadPage.test.tsx`:
```tsx
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeWorker } from '../../test/fakeWorker'
import { stubFetch } from '../../test/fetch'
import { healthFixture, parseResultFixture } from '../../test/fixtures'
import { authValue, renderAt } from '../../test/utils'
import { UploadPage, ownDataSummary } from './UploadPage'

afterEach(() => {
  vi.unstubAllGlobals()
})

function setup(opts: { save?: () => Promise<void>; auth?: ReturnType<typeof authValue> } = {}) {
  const workers: FakeWorker[] = []
  const createWorker = () => {
    const w = new FakeWorker()
    workers.push(w)
    return w
  }
  const save = vi.fn(opts.save ?? (() => Promise.resolve()))
  renderAt(<UploadPage createWorker={createWorker} save={save} />, { route: '/upload', auth: opts.auth })
  return { workers, save }
}

const zip = () => new File(['x'], 'export.zip', { type: 'application/zip' })

async function chooseFile(file = zip()) {
  await userEvent.upload(screen.getByLabelText(/choose your export/i), file)
}

describe('ownDataSummary', () => {
  it('is null for no data and for the demo dataset', () => {
    expect(ownDataSummary(null)).toBeNull()
    expect(ownDataSummary(undefined)).toBeNull()
    expect(ownDataSummary(healthFixture({ is_demo: true }))).toBeNull()
  })

  it('summarizes the user own data', () => {
    expect(ownDataSummary(healthFixture())).toEqual({ days: 1, lastDate: '2026-09-30' })
  })
})

describe('UploadPage', () => {
  it('starts with the guide and the drop zone', () => {
    stubFetch(200, { error: 'No health data found.' })
    setup()
    expect(screen.getByRole('heading', { name: 'Upload your Apple Health export' })).toBeInTheDocument()
    expect(screen.getByText(/How to export your Apple Health data/)).toBeInTheDocument()
    expect(screen.getByLabelText(/choose your export/i)).toBeInTheDocument()
  })

  it('walks from a file to a preview to a saved account', async () => {
    stubFetch(200, { error: 'No health data found.' })
    const { workers, save } = setup()
    await chooseFile()
    expect(workers).toHaveLength(1)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()

    act(() => workers[0].emit({ type: 'progress', fraction: 0.5, recordsSeen: 10 }))
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')

    const result = parseResultFixture()
    act(() => workers[0].emit({ type: 'done', result }))
    expect(screen.getByText("Here's what we found")).toBeInTheDocument()
    expect(screen.getByText('Nothing has been saved yet.')).toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Save to my account' }))
    expect(save).toHaveBeenCalledWith(result)
    expect(await screen.findByRole('heading', { name: 'Your data is saved' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute('href', '/')
  })

  it('warns when saving will replace existing data', async () => {
    stubFetch(200, healthFixture())
    const { workers } = setup()
    await chooseFile()
    act(() => workers[0].emit({ type: 'done', result: parseResultFixture() }))
    expect(
      await screen.findByText(
        'This replaces your current data (1 days, through 2026-09-30). Your life events are kept.',
      ),
    ).toBeInTheDocument()
  })

  it('does not show the replace warning when the user only has the sample data', async () => {
    stubFetch(200, healthFixture({ is_demo: true }))
    const { workers } = setup()
    await chooseFile()
    act(() => workers[0].emit({ type: 'done', result: parseResultFixture() }))
    expect(await screen.findByText("Here's what we found")).toBeInTheDocument()
    expect(screen.queryByText(/replaces your current data/)).not.toBeInTheDocument()
  })

  it('shows a specific error for a parse failure and recovers with a new file', async () => {
    stubFetch(200, { error: 'No health data found.' })
    const { workers } = setup()
    await chooseFile()
    act(() => workers[0].emit({ type: 'error', code: 'corrupt-file', message: 'x' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/damaged or incomplete/)
    await userEvent.click(screen.getByRole('button', { name: 'Choose a different file' }))
    expect(screen.getByLabelText(/choose your export/i)).toBeInTheDocument()
  })

  it('rejects the wrong file type with a message', async () => {
    stubFetch(200, { error: 'No health data found.' })
    setup()
    const user = userEvent.setup({ applyAccept: false })
    await user.upload(screen.getByLabelText(/choose your export/i), new File(['x'], 'notes.txt'))
    expect(screen.getByRole('alert')).toHaveTextContent(/isn't an Apple Health export/)
  })

  it('cancels a running parse', async () => {
    stubFetch(200, { error: 'No health data found.' })
    const { workers } = setup()
    await chooseFile()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(workers[0].terminated).toBe(true)
    expect(screen.getByLabelText(/choose your export/i)).toBeInTheDocument()
  })

  it('keeps the parsed result when saving fails and Try again succeeds', async () => {
    stubFetch(200, { error: 'No health data found.' })
    let attempts = 0
    const { workers, save } = setup({
      save: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('network')
      },
    })
    await chooseFile()
    act(() => workers[0].emit({ type: 'done', result: parseResultFixture() }))
    await userEvent.click(screen.getByRole('button', { name: 'Save to my account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't save your data/i)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Your data is saved' })).toBeInTheDocument()
    expect(save).toHaveBeenCalledTimes(2)
    expect(workers).toHaveLength(1)
  })

  it('disables Save with an explanation in local (unconfigured) mode', async () => {
    stubFetch(200, { error: 'No health data found.' })
    const { workers } = setup({ auth: authValue({ status: 'unconfigured', email: null }) })
    await chooseFile()
    act(() => workers[0].emit({ type: 'done', result: parseResultFixture() }))
    expect(screen.getByRole('button', { name: 'Save to my account' })).toBeDisabled()
    expect(screen.getByText(/Saving isn't available in local mode/)).toBeInTheDocument()
  })
})
```

Changes to existing tests:

In `web/src/app/Shell.test.tsx`, inside the test `has persistent navigation to Dashboard, Insights and Settings`, after the Settings `expect(...)` line add:
```tsx
    expect(screen.getByRole('link', { name: 'Upload' })).toHaveAttribute('href', '/upload')
```

In `web/src/app/AppRoutes.test.tsx` add inside `describe('AppRoutes', ...)`:
```tsx
  it('serves the upload page', () => {
    stubFetch(200, healthFixture())
    renderAt(<AppRoutes />, { route: '/upload' })
    expect(screen.getByRole('heading', { name: 'Upload your Apple Health export' })).toBeInTheDocument()
  })
```

In `web/src/features/dashboard/DashboardPage.test.tsx`: change the assertion
`expect(screen.getByRole('link', { name: 'Upload your own data' })).toHaveAttribute('href', '/')`
to `... toHaveAttribute('href', '/upload')`; in the test `tells new users there is no data yet when the server has none`, add after the heading assertion:
```tsx
    expect(screen.getByRole('link', { name: 'Upload your export' })).toHaveAttribute('href', '/upload')
```
and add a new test:
```tsx
  it('shows an outage as an error, not as "no health data yet"', async () => {
    stubFetch(503, { error: 'Health data is temporarily unavailable. Please try again.' })
    renderAt(<DashboardPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Health data is temporarily unavailable')
    expect(screen.queryByRole('heading', { name: 'No health data yet' })).not.toBeInTheDocument()
  })
```
(The test helpers' query client has `retry: false`, so the 503 surfaces immediately.)

- [ ] **Step 2: Run to verify failure**

Run: `npm --prefix web test -- src/features src/app`
Expected: FAIL: `UploadPage` does not exist; the updated dashboard, shell and routes assertions fail.

- [ ] **Step 3: Implement**

`web/src/lib/health/useHealthQuery.ts`:
```ts
import { useQuery } from '@tanstack/react-query'
import { getHealth } from '../api/client'
import { useAuth } from '../supabase/auth'

/** The signed-in user's health data (own or demo), shared by the dashboard and the upload page. */
export function useHealthQuery() {
  const { email, getToken } = useAuth()
  return useQuery({
    queryKey: ['health', email],
    queryFn: () => getHealth(getToken),
  })
}
```

`web/src/features/upload/UploadPage.tsx`:
```tsx
import { Link } from 'react-router-dom'
import type { HealthData } from '../../lib/health/types'
import { useHealthQuery } from '../../lib/health/useHealthQuery'
import { useHealthUpload, type HealthUploadOptions } from '../../lib/health/useHealthUpload'
import { useAuth } from '../../lib/supabase/auth'
import { DropZone } from './DropZone'
import { ErrorPanel } from './ErrorPanel'
import { ExportGuide } from './ExportGuide'
import { PreviewPanel } from './PreviewPanel'
import { ReadingProgress } from './ReadingProgress'

/** What a re-upload would replace: null when the user has no data of their own (none, or the demo). */
export function ownDataSummary(
  data: HealthData | null | undefined,
): { days: number; lastDate: string | null } | null {
  if (!data || data.is_demo) return null
  const dates = Object.keys(data.daily).sort()
  return { days: data.summary.total_days, lastDate: dates.at(-1) ?? null }
}

export function UploadPage(options: HealthUploadOptions = {}) {
  const { status } = useAuth()
  const health = useHealthQuery()
  const upload = useHealthUpload(options)
  const { state } = upload
  const saveDisabledReason =
    status === 'unconfigured' ? "Saving isn't available in local mode (Supabase isn't configured)." : null

  return (
    <section className="upload-page">
      <h1>Upload your Apple Health export</h1>

      {state.phase === 'idle' && (
        <>
          <ExportGuide />
          <DropZone onFile={upload.start} />
        </>
      )}

      {state.phase === 'reading' && (
        <ReadingProgress
          fileName={state.fileName}
          fraction={state.fraction}
          recordsSeen={state.recordsSeen}
          startedAt={state.startedAt}
          onCancel={upload.reset}
        />
      )}

      {(state.phase === 'parsed' || state.phase === 'saving') && (
        <PreviewPanel
          result={state.result}
          existing={ownDataSummary(health.data)}
          saving={state.phase === 'saving'}
          saveDisabledReason={saveDisabledReason}
          onSave={() => void upload.save()}
          onChooseAnother={upload.reset}
        />
      )}

      {state.phase === 'saved' && (
        <div role="status">
          <h2>Your data is saved</h2>
          <p>{state.result.summary.total_days} days of data are now in your account.</p>
          <p>
            <Link to="/">Go to dashboard</Link>
          </p>
        </div>
      )}

      {state.phase === 'error' && (
        <ErrorPanel
          error={state.error}
          onRetry={state.result ? () => void upload.save() : undefined}
          onReset={upload.reset}
        />
      )}
    </section>
  )
}
```

`web/src/features/dashboard/DashboardPage.tsx` (replace the file):
```tsx
import { Link } from 'react-router-dom'
import { useHealthQuery } from '../../lib/health/useHealthQuery'

export function DashboardPage() {
  const { data, isPending, error } = useHealthQuery()

  if (isPending) return <p role="status">Loading your data…</p>
  if (error) return <p role="alert">{error.message}</p>

  if (data === null) {
    return (
      <section>
        <h1>No health data yet</h1>
        <p>Upload your Apple Health export to see your dashboard.</p>
        <p>
          <Link to="/upload">Upload your export</Link>
        </p>
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
          You're viewing sample data. <Link to="/upload">Upload your own data</Link>
        </p>
      )}
      <p>{data.summary.total_days} days of data</p>
    </section>
  )
}
```

`web/src/app/AppRoutes.tsx`: add `import { UploadPage } from '../features/upload/UploadPage'` and, inside the `<Route element={<Shell />}>` block after the `index` route:
```tsx
          <Route path="upload" element={<UploadPage />} />
```

`web/src/app/Shell.tsx`: add after the Dashboard `NavLink`:
```tsx
          <NavLink to="/upload">Upload</NavLink>
```

- [ ] **Step 4: Run to verify pass, then every check including the production build**

Run: `npm --prefix web test` -> Expected: all PASS.
Run: `npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web run build` -> Expected: exit 0.
Run: `ls web/dist/assets` -> Expected: a separate worker chunk exists (a `.js` file whose name contains `parse` or `worker`); `fflate` code lives in it. If no separate worker file is emitted, report it instead of guessing.
Run: `python -m pytest -q` -> Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "feat(web): upload page, shared health query, nav link and dashboard entry points"
```

---

### Task 11: Docs and spec amendments

Research for this plan corrected two spec sentences and added one intentional difference. Keep the docs honest.

**Files:**
- Modify: `docs/superpowers/specs/2026-10-04-upload-flow-design.md`, `README.md`, `CLAUDE.md`

Preserve each file's existing line endings (`README.md` and `CLAUDE.md` are CRLF in the working tree); the diff for each file must show only the intended hunks.

- [ ] **Step 1: Amend the upload spec**

Replace, in the `metrics.ts` bullet, the sentence
`Only metrics that are saved are collected; \`respiratory_rate\` and \`walking_hr\` (collected but never saved by the classic parser) are not.`
with
`Values for \`respiratory_rate\` and \`walking_hr\` (never saved by the classic parser) are not accumulated, but such a record still creates its day entry, exactly as in the classic parser, so \`total_days\` matches.`

Replace, in the `fileToChunks(file)` bullet, the text
`\`.zip\` -> streaming unzip of the entry whose basename is \`export.xml\`; if none, the largest \`.xml\` entry whose name does not contain "cda" (Apple localizes export file names).`
with
`\`.zip\` -> streaming unzip of the first \`.xml\` entry whose name does not contain "cda" and is not macOS resource-fork junk (\`__MACOSX/\` or a \`._\` basename). This finds \`export.xml\` and its localized variants in a single pass; "largest" was dropped because entry sizes are not known up front in a streamed ZIP.`

In "Intentional differences from the classic parser", replace the bullet `- Collects only metrics that are saved.` with
`- Sleep timestamps are parsed as ISO local time (\`T\` separator), so sleep works in Safari (the classic space-separated form is not parsed by Safari).`

If an exact string is not found (line wrapping may differ), find the equivalent sentence and apply the same meaning; list what you changed in the report.

- [ ] **Step 2: README** — add a short section after the "New app (work in progress)" section:

```markdown
### Uploading Apple Health data in the new app

Open `/app/upload`, drop Apple's `export.zip` (or `export.xml`) and review the preview, then press **Save**. The file is parsed in your browser by a Web Worker (see `web/src/lib/health/`), and only aggregated daily numbers are saved to your account. Re-uploading replaces your data and keeps your life events. The classic upload at `/` still works.
```

- [ ] **Step 3: CLAUDE.md** — under "Frontend Notes" append:

```markdown
- The new app's upload flow (`web/src/features/upload/`, parser in `web/src/lib/health/`): `parseExport` streams XML chunks into per-day running totals (O(days) memory) inside a Web Worker; `fileToChunks` reads `.xml` or streams the health XML entry out of `.zip` with `fflate`; `repository.ts` saves under RLS and keeps the user's existing `events`. `parity.test.ts` extracts the classic `parseHealthXML` from `index.html` and asserts identical output, so the two parsers must stay in step until the classic one is removed.
- `/api/health` and `/api/chat` answer `503` (not "No health data found") when Supabase cannot be queried.
```

- [ ] **Step 4: Verify and commit**

Run: `python -m pytest -q && npm --prefix web test && npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web run build` -> Expected: all pass.
Run: `git diff --stat` -> Expected: small hunks only in the three docs.

```bash
git add README.md CLAUDE.md docs
git commit -m "docs: upload flow in README and CLAUDE.md; correct two spec details"
```

---

### Task 12: Acceptance on a Vercel preview (manual, for the user)

Needs a real export, so it cannot be automated. Push the branch and open the PR first (the executing session asks before doing so).

- [ ] **Step 1: Real export, large.** On the preview, sign in to `/app/`, open **Upload**, and drop your real `export.zip` (hundreds of MB). Check: the tab stays responsive (you can scroll and click Cancel), the progress bar moves, the preview appears, and the numbers (days, averages) match what the classic app shows for the same export. Try both the ZIP and the unzipped `export.xml`.
- [ ] **Step 2: Save and dashboard.** Press Save, then open the dashboard: it shows your own data (no "sample data" banner). Upload again: the preview warns that it replaces your data and keeps your events.
- [ ] **Step 3: Errors.** Drop a `.txt` file, an empty file, and a ZIP that has no `export.xml`: each gives a specific message and a way to try again. Start a big upload and press Cancel: the page returns to the drop zone.
- [ ] **Step 4: Classic app.** At `/` the classic upload and dashboard still work with the same export.
- [ ] **Step 5: Merge** once the above passes, then tell the user the outage-vs-no-data fix (Task 2) is live, so uploading is safe to announce.

---

## Self-Review

**Spec coverage** (`2026-10-04-upload-flow-design.md`):
- Parser core: streaming decode, carry-over, quote-aware tokenizer, per-day totals, retention while parsing, 1 MB carry guard, `maxCarryBytes` -> Task 4. `summary.ts` -> Task 3. Metric map -> Task 3.
- `fileToChunks`: XML, ZIP, error codes, entry selection (amended to first non-CDA `.xml`, Task 11), 64 KB `<HealthData` check (in `parseExport`, Task 4), progress by source bytes -> Task 6.
- Worker, protocol, hook (states, cancel, unmount, single-flight, retry) -> Task 8. ZIP64/data-descriptor spike -> Task 1.
- Screens 1-5 (guide, reading, preview with replace notice and sparklines, saved, errors) and entry points (dashboard empty state, banner, nav link) -> Tasks 9-10.
- Saving: repository, events carried over, never the demo row, `updated_at`, replace semantics, error mapping, `not-configured` disabled Save -> Tasks 7, 10.
- Security/privacy: no network during parse (Tasks 4, 6), no `innerHTML` (React only).
- Tests: fixtures, parity, chunk-boundary, memory bound, hook, repository, screens -> Tasks 4-10. Acceptance on preview -> Task 12.
- Out-of-scope items are not planned. The API outage bug the spec says must ship first -> Task 2 (and Task 10's dashboard test).
- Deviations recorded: fallback entry rule and parity-driven day creation for unsaved metrics (Task 11 amends the spec); Safari-safe sleep date parsing (added as an intentional difference).

**Placeholder scan:** none; every code step contains the code. The only contingencies are explicit stop-and-report instructions (Task 1 spike failure, parity mismatch, TS cast).

**Type consistency:** `UploadErrorCode`/`UploadErrorInfo`/`UploadError` (Task 3) are used unchanged in Tasks 6-10. `ParseResult`/`ParseStats` (Task 3) match `parseExport`'s return (Task 4) and the fixtures (Tasks 7-8). `ChunkableFile` (Task 6) is the type the helper and tests use. `WorkerLike`/`WorkerMessage` (Task 8) match `FakeWorker` and the hook. `HealthUploadOptions` (Task 8) is what `UploadPage` forwards (Task 10). Button labels used in tests ("Save to my account", "Choose a different file", "Try again", "Cancel", "Saving…") match the components; the heading texts ("Upload your Apple Health export", "Here's what we found", "Your data is saved") match.

**Known risks:** (1) `fflate` ZIP64/streamed behaviour is settled by Task 1 before anything else is built; (2) real-export throughput is only verified in Task 12; (3) Vite's module-worker build (`worker.format: 'es'`) is verified by the Task 10 build; (4) users who uploaded through the classic app after the Step 0 migration carry the classic app's default student-calendar events, and a re-upload in the new app keeps them (expected under "keep existing events").
