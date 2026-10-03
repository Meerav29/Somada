# Step 0: Per-User Data and Authenticated API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop all users sharing one publicly readable `health_data` row by giving each user their own RLS-protected row, a separate read-only demo row, and an API that only serves data to a verified caller.

**Architecture:** A new SQL migration adds `user_id` and `is_demo` to `health_data` with RLS scoped to `auth.uid()`. The Python API verifies the caller's Supabase JWT (`GET /auth/v1/user`) and then queries PostgREST **with the caller's JWT** so RLS, not application code, decides visibility. The legacy `index.html` is patched minimally to send the token and upsert by `user_id`.

**Tech Stack:** Supabase (Postgres, RLS, PostgREST, Auth), Python 3.12 stdlib `http.server`/`urllib` on Vercel, pytest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-03-somada-modernization-design.md` (section "Step 0 — Privacy fix"). This is plan 1 of 6, one per rollout step. Steps 1-5 (Vite/React rebuild) and the cutover get their own plans after this ships.

## Global Constraints

- Missing or invalid token returns **401**; no `limit=1` fallback and no anon-key reads of user data.
- The legacy `index.html` keeps working for existing users throughout (patched in this plan, not rewritten).
- BYOK keys remain browser-only; the server never stores or logs them.
- `api/config.py` and `api/supabase_config.py` remain public and unchanged.
- No new runtime dependencies: stdlib only in `api/`. Dev-only deps go in `requirements-dev.txt` (never `requirements.txt`, which Vercel would install).
- When `SUPABASE_URL`/`SUPABASE_ANON_KEY` are unset (local dev via `server.py`), behavior is unchanged: no auth, local `health_data.json`.
- Demo data is a dedicated read-only row (`is_demo = true`) holding **synthetic** data, never a real person's export.
- Rate limiting, model-ID changes and grounded-chat work are **out of scope** here (later plans).
- Default git branch is `master`. Do all work on `feat/per-user-data`.

## File Structure

```text
supabase/
  migrations/0001_initial_health_data.sql     # NEW: original schema, for fresh installs only
  migrations/0002_per_user_health_data.sql    # NEW: the privacy fix (run this on the live DB)
  rollback/0002_down.sql                      # NEW: emergency revert of 0002
  tests/rls_check.sql                         # NEW: RLS assertions, run on a scratch project
  seed_demo.sql                               # NEW (generated): synthetic demo row
scripts/make_demo_seed.py                     # NEW: deterministic synthetic demo generator
api/supabase_http.py                          # NEW: env detection + tiny HTTP GET helper
api/auth.py                                   # NEW: bearer extraction, JWT verification
api/chat_core.py                              # MODIFY: per-user fetch, auth-aware load_health_data
api/chat.py, api/health.py                    # MODIFY: authenticate first, 401 on failure
index.html                                    # MODIFY: send token, upsert by user_id
tests/api/{conftest,test_auth,test_chat_core_data,test_handlers}.py   # NEW
tests/scripts/test_make_demo_seed.py          # NEW
pytest.ini, requirements-dev.txt              # NEW
.github/workflows/tests.yml                   # NEW
README.md, CLAUDE.md                          # MODIFY: schema + auth docs
```

---

### Task 1: Branch, verify live schema, back up the legacy row

**Files:**
- No repo files changed except committing the spec and this plan.

**Interfaces:**
- Produces: a confirmed answer to "does the live `health_data` table match the README schema?" Later tasks assume columns `id integer PK`, `data jsonb`, `updated_at timestamptz` and policies `allow_public_read` / `allow_auth_write`. If the answer is no, **stop and revise Task 2** before continuing.

- [ ] **Step 1: Create the branch and commit the spec and plan**

```bash
cd /c/Users/meera/Github-Projects/Somada
git checkout -b feat/per-user-data
git add docs/superpowers/specs docs/superpowers/plans
git commit -m "docs: add modernization spec and Step 0 plan"
```

- [ ] **Step 2: Inspect the live schema** (Supabase dashboard → SQL editor, production project)

```sql
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'health_data'
order by ordinal_position;

select id, updated_at, length(data::text) as bytes from public.health_data;

select policyname, cmd, roles, qual, with_check
from pg_policies where tablename = 'health_data';
```

Expected: columns `id` (integer, default `1`), `data` (jsonb), `updated_at` (timestamptz); one row with `id = 1`; policies `allow_public_read` (SELECT, `true`) and `allow_auth_write` (ALL). If anything differs, note it and revise Task 2's SQL before proceeding.

- [ ] **Step 3: Back up the legacy row outside the repo**

In the SQL editor run `select * from public.health_data;`, export the result as CSV, and save it to `C:\Users\meera\somada-backup\health_data-2026-10-03.csv`. This folder is **outside** the repo on purpose (personal health data must never be committed).

- [ ] **Step 4: Create a scratch Supabase project for testing** (free tier, name `somada-scratch`). Note its URL and anon key in your password manager. All RLS testing in Task 2 runs here, not on production.

No commit (nothing changed beyond Step 1).

---

### Task 2: Migrations, rollback, RLS check, and schema docs

**Files:**
- Create: `supabase/migrations/0001_initial_health_data.sql`
- Create: `supabase/migrations/0002_per_user_health_data.sql`
- Create: `supabase/rollback/0002_down.sql`
- Create: `supabase/tests/rls_check.sql`
- Modify: `README.md` (self-host step 1 and the "Data note"), `CLAUDE.md` (Supabase → Database section)

**Interfaces:**
- Produces: table `public.health_data(id integer PK, data jsonb, updated_at timestamptz, user_id uuid UNIQUE NULL, is_demo boolean)`. Invariants: a row is either a user's row (`user_id` set, `is_demo = false`) or the single demo row (`user_id` null, `is_demo = true`). The legacy row keeps `user_id` null / `is_demo` false, so it is invisible to everyone under RLS but still present for rollback.
- Produces: upsert contract `upsert({ user_id, data }, { onConflict: 'user_id' })` (needs a plain unique constraint, not a partial index, or PostgREST rejects `on_conflict`).

- [ ] **Step 1: Write the failing RLS check** — `supabase/tests/rls_check.sql`

```sql
-- Run in the SQL editor of the SCRATCH project after applying 0001 and 0002.
-- Everything happens in one transaction that is rolled back. A failed assertion
-- raises an exception; success prints ALL RLS CHECKS PASSED at the end.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'b@test.local'),
  ('00000000-0000-0000-0000-0000000000c3', 'c@test.local');

insert into public.health_data (user_id, data) values
  ('00000000-0000-0000-0000-0000000000a1', '{"who":"a"}'),
  ('00000000-0000-0000-0000-0000000000b2', '{"who":"b"}');
insert into public.health_data (is_demo, data) values (true, '{"who":"demo"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

do $$
declare n int;
begin
  select count(*) into n from public.health_data where data->>'who' = 'b';
  if n <> 0 then raise exception 'FAIL: user A can read user B row'; end if;

  select count(*) into n from public.health_data where data->>'who' = 'a';
  if n <> 1 then raise exception 'FAIL: user A cannot read own row'; end if;

  select count(*) into n from public.health_data where is_demo;
  if n <> 1 then raise exception 'FAIL: user A cannot read demo row'; end if;

  update public.health_data set data = '{"who":"hacked"}' where data->>'who' = 'b';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user A updated user B row'; end if;

  update public.health_data set data = '{"who":"hacked"}' where is_demo;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user A updated the demo row'; end if;

  begin
    insert into public.health_data (user_id, data)
    values ('00000000-0000-0000-0000-0000000000c3', '{}');
    raise exception 'FAIL: user A inserted a row for user C';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.health_data (is_demo, data) values (true, '{}');
    raise exception 'FAIL: user A inserted a demo row';
  exception when insufficient_privilege or unique_violation then null;
  end;
end $$;

reset role;
set local role anon;
do $$
declare n int;
begin
  begin
    select count(*) into n from public.health_data;
    if n <> 0 then raise exception 'FAIL: anon can read % rows', n; end if;
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
select 'ALL RLS CHECKS PASSED' as result;
```

- [ ] **Step 2: Write the original schema** — `supabase/migrations/0001_initial_health_data.sql`

```sql
-- FRESH INSTALLS ONLY. Existing deployments already have this table; skip to 0002.
create table if not exists public.health_data (
  id integer primary key default 1,
  data jsonb not null,
  updated_at timestamptz default now()
);
alter table public.health_data enable row level security;
```

- [ ] **Step 3: Run the check on the scratch project to verify it FAILS**

In the scratch project apply only `0001` (SQL editor), then run `rls_check.sql`.
Expected: error `column "user_id" of relation "health_data" does not exist` (the failing-test state).

- [ ] **Step 4: Write the migration** — `supabase/migrations/0002_per_user_health_data.sql`

```sql
-- Per-user health data with row-level security.
-- Safe to run once on the live database. The legacy shared row (id = 1) is left in
-- place but becomes invisible to every role (user_id null, is_demo false), so it can
-- be assigned to its owner later or used for rollback.
begin;

-- id stays the primary key but stops defaulting to 1.
create sequence if not exists public.health_data_id_seq owned by public.health_data.id;
select setval('public.health_data_id_seq',
              greatest((select coalesce(max(id), 1) from public.health_data), 1));
alter table public.health_data
  alter column id set default nextval('public.health_data_id_seq');

alter table public.health_data
  add column user_id uuid references auth.users (id) on delete cascade,
  add column is_demo boolean not null default false;

-- Plain unique constraint (NULLs are distinct) so PostgREST on_conflict=user_id works.
alter table public.health_data
  add constraint health_data_user_id_key unique (user_id);
-- At most one demo row.
create unique index health_data_single_demo on public.health_data (is_demo) where is_demo;
-- A demo row has no owner.
alter table public.health_data
  add constraint health_data_demo_has_no_owner check (not is_demo or user_id is null);

drop policy if exists "allow_public_read" on public.health_data;
drop policy if exists "allow_auth_write" on public.health_data;

create policy "own_row_select" on public.health_data
  for select to authenticated using (user_id = (select auth.uid()));
create policy "demo_row_select" on public.health_data
  for select to authenticated using (is_demo);
create policy "own_row_insert" on public.health_data
  for insert to authenticated
  with check (user_id = (select auth.uid()) and not is_demo);
create policy "own_row_update" on public.health_data
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and not is_demo);
create policy "own_row_delete" on public.health_data
  for delete to authenticated using (user_id = (select auth.uid()));

commit;
```

- [ ] **Step 5: Write the rollback** — `supabase/rollback/0002_down.sql`

```sql
-- Emergency revert: restores the old shared, publicly readable behavior.
-- Columns are kept; the legacy row (id = 1) is still intact, so the old app works again.
begin;
drop policy if exists "own_row_select" on public.health_data;
drop policy if exists "demo_row_select" on public.health_data;
drop policy if exists "own_row_insert" on public.health_data;
drop policy if exists "own_row_update" on public.health_data;
drop policy if exists "own_row_delete" on public.health_data;
create policy "allow_public_read" on public.health_data for select using (true);
create policy "allow_auth_write" on public.health_data
  for all using (auth.role() = 'authenticated');
commit;
```

- [ ] **Step 6: Apply 0002 on the scratch project and verify the check PASSES**

Run `0002_per_user_health_data.sql`, then `rls_check.sql`.
Expected: final result row `ALL RLS CHECKS PASSED`. If `insert into auth.users (id, email)` is rejected for a missing NOT NULL column, add that column to the insert (Supabase versions differ) and re-run.

- [ ] **Step 7: Update the docs**

In `README.md`, replace the whole "#### 1. Create the Supabase table" block (the SQL snippet and its heading) with:

```markdown
#### 1. Create the Supabase table

In your Supabase SQL editor, run the files in `supabase/migrations/` in order
(`0001_initial_health_data.sql`, then `0002_per_user_health_data.sql`). Each user gets
their own row protected by row-level security. Optionally run `supabase/seed_demo.sql`
to add the synthetic demo dataset that new accounts browse before uploading their own data.
```

In `README.md`, replace the "**Data note:**" paragraph with:

```markdown
**Data note:** each account's health data is stored in its own row in a shared Supabase instance, protected by row-level security so only the signed-in owner can read or write it. If you want your data to never leave your own infrastructure, use the self-hosted path below.
```

In `CLAUDE.md`, replace the whole "### Database" subsection (heading through the RLS SQL block) with:

```markdown
### Database

Single table `health_data` (see `supabase/migrations/`). One row per user (`user_id`, unique) plus at most one read-only synthetic demo row (`is_demo = true`). RLS: a signed-in user can read/write only their own row and read the demo row; anonymous users get nothing. The API forwards the caller's JWT to PostgREST so RLS enforces this. Upsert from the client with `onConflict: 'user_id'`.
```

- [ ] **Step 8: Commit**

```bash
git add supabase README.md CLAUDE.md
git commit -m "feat(db): per-user health_data with RLS, demo row, rollback and RLS check"
```

---

### Task 3: Supabase HTTP helper and JWT verification

**Files:**
- Create: `requirements-dev.txt`, `pytest.ini`
- Create: `api/supabase_http.py`, `api/auth.py`
- Create: `tests/api/conftest.py`, `tests/api/test_auth.py`

**Interfaces:**
- Produces (`api/supabase_http.py`):
  - `supabase_env() -> tuple[str | None, str | None]` — `(url, anon_key)` with trailing `/` stripped, or `(None, None)` when unset or placeholder.
  - `supabase_configured() -> bool`
  - `http_get_json(url: str, headers: dict, timeout: int = 3) -> tuple[int, object | None]` — `(status, parsed_json)`; `(code, None)` on HTTP error; `(0, None)` on network/parse failure. Never raises.
- Produces (`api/auth.py`):
  - `class AuthError(Exception)`
  - `class AuthContext` with attributes `user_id: str | None`, `token: str | None`
  - `extract_bearer_token(headers) -> str | None` (headers is any object with `.get`)
  - `verify_token(token: str) -> str` — returns the user id or raises `AuthError`
  - `authenticate(headers) -> AuthContext` — local-dev `AuthContext()` (both `None`) when Supabase is not configured; otherwise verified context or raises `AuthError`.
- Produces (`tests/api/conftest.py`): fixtures `fake_supabase` (monkeypatches `api.supabase_http.http_get_json`; returns a state dict) and `call` (HTTP round-trip helper, used in Task 5).

- [ ] **Step 1: Add test tooling**

`requirements-dev.txt`:
```text
pytest>=8
```

`pytest.ini`:
```ini
[pytest]
pythonpath = .
testpaths = tests
```

- [ ] **Step 2: Write shared fixtures** — `tests/api/conftest.py`

```python
import json
import threading
import urllib.error
import urllib.request
from http.server import HTTPServer

import pytest


@pytest.fixture
def fake_supabase(monkeypatch):
    """Configure Supabase env and replace http_get_json with an RLS-emulating fake."""
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    state = {
        "users": {"token-a": "user-a", "token-b": "user-b"},
        "rows": {"user-a": {"who": "a"}, "user-b": {"who": "b"}},
        "demo": {"who": "demo"},
        "calls": [],
    }

    def fake_get(url, headers, timeout=3):
        state["calls"].append((url, dict(headers)))
        token = headers.get("Authorization", "").removeprefix("Bearer ")
        uid = state["users"].get(token)
        if "/auth/v1/user" in url:
            return (200, {"id": uid}) if uid else (401, None)
        if not uid:  # anon / bad token sees nothing under RLS
            return 200, []
        if "user_id=eq." in url:
            requested = url.split("user_id=eq.")[1].split("&")[0]
            row = state["rows"].get(requested) if requested == uid else None
            return 200, ([{"data": row}] if row else [])
        if "is_demo=eq.true" in url:
            return 200, ([{"data": state["demo"]}] if state["demo"] else [])
        return 200, []

    monkeypatch.setattr("api.supabase_http.http_get_json", fake_get)
    return state


@pytest.fixture
def no_supabase(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)


@pytest.fixture
def call():
    """call(handler_cls, method='GET', headers=None, body=None) -> (status, json)."""
    servers = []

    def _call(handler_cls, method="GET", headers=None, body=None):
        server = HTTPServer(("127.0.0.1", 0), handler_cls)
        servers.append(server)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}/",
            data=data,
            method=method,
            headers={"Content-Type": "application/json", **(headers or {})},
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    yield _call
    for s in servers:
        s.shutdown()
        s.server_close()
```

- [ ] **Step 3: Write the failing tests** — `tests/api/test_auth.py`

```python
import pytest

from api.auth import AuthError, authenticate, extract_bearer_token, verify_token
from api.supabase_http import supabase_configured, supabase_env


def test_extract_bearer_token_valid():
    assert extract_bearer_token({"Authorization": "Bearer abc.def"}) == "abc.def"


@pytest.mark.parametrize("value", [None, "", "Bearer", "Bearer   ", "Basic abc", "abc"])
def test_extract_bearer_token_rejects_malformed(value):
    headers = {} if value is None else {"Authorization": value}
    assert extract_bearer_token(headers) is None


def test_supabase_env_unset(no_supabase):
    assert supabase_env() == (None, None)
    assert supabase_configured() is False


def test_supabase_env_placeholder_is_unconfigured(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://your-supabase.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "your_supabase_anon_key")
    assert supabase_configured() is False


def test_supabase_env_strips_trailing_slash(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co/")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "k")
    assert supabase_env() == ("https://example.supabase.co", "k")


def test_verify_token_returns_user_id(fake_supabase):
    assert verify_token("token-a") == "user-a"


def test_verify_token_rejects_unknown_token(fake_supabase):
    with pytest.raises(AuthError):
        verify_token("nope")


def test_authenticate_local_dev_needs_no_token(no_supabase):
    ctx = authenticate({})
    assert ctx.user_id is None and ctx.token is None


def test_authenticate_requires_token_when_configured(fake_supabase):
    with pytest.raises(AuthError):
        authenticate({})


def test_authenticate_returns_verified_context(fake_supabase):
    ctx = authenticate({"Authorization": "Bearer token-b"})
    assert ctx.user_id == "user-b" and ctx.token == "token-b"


def test_authenticate_rejects_bad_token(fake_supabase):
    with pytest.raises(AuthError):
        authenticate({"Authorization": "Bearer nope"})
```

- [ ] **Step 4: Run to verify failure**

Run: `python -m pytest tests/api/test_auth.py -v`
Expected: collection error `ModuleNotFoundError: No module named 'api.auth'`.

- [ ] **Step 5: Implement** — `api/supabase_http.py`

```python
import json
import os
import urllib.error
import urllib.request


def supabase_env():
    """Return (url, anon_key), or (None, None) when Supabase is not configured."""
    url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    anon_key = os.environ.get("SUPABASE_ANON_KEY", "").strip()
    if not url or not anon_key:
        return None, None
    if "your-supabase" in url or "your_supabase" in anon_key.lower():
        return None, None
    return url, anon_key


def supabase_configured():
    return supabase_env()[0] is not None


def http_get_json(url, headers, timeout=3):
    """GET a URL; return (status, parsed_json). Never raises: failures give (code, None) or (0, None)."""
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, None
    except (urllib.error.URLError, TimeoutError, ValueError):
        return 0, None
```

`api/auth.py`:

```python
import api.supabase_http as supabase_http


class AuthError(Exception):
    pass


class AuthContext:
    """Who is calling. Both fields are None in local dev (Supabase not configured)."""

    def __init__(self, user_id=None, token=None):
        self.user_id = user_id
        self.token = token


def extract_bearer_token(headers):
    scheme, _, token = (headers.get("Authorization") or "").strip().partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def verify_token(token):
    """Ask Supabase Auth who owns this token. Returns the user id or raises AuthError."""
    url, anon_key = supabase_http.supabase_env()
    status, body = supabase_http.http_get_json(
        f"{url}/auth/v1/user",
        {"apikey": anon_key, "Authorization": f"Bearer {token}"},
    )
    if status != 200 or not body or not body.get("id"):
        raise AuthError("Invalid or expired session.")
    return body["id"]


def authenticate(headers):
    if not supabase_http.supabase_configured():
        return AuthContext()
    token = extract_bearer_token(headers)
    if not token:
        raise AuthError("Sign in required.")
    return AuthContext(user_id=verify_token(token), token=token)
```

- [ ] **Step 6: Run to verify pass**

Run: `python -m pytest tests/api/test_auth.py -v`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add requirements-dev.txt pytest.ini api/supabase_http.py api/auth.py tests/api
git commit -m "feat(api): verify Supabase JWTs and add Supabase env/http helper"
```

---

### Task 4: Per-user data loading in `chat_core`

**Files:**
- Modify: `api/chat_core.py:47-86` (replace `fetch_supabase_health_data` and `load_health_data`)
- Create: `tests/api/test_chat_core_data.py`

**Interfaces:**
- Consumes: `api.supabase_http.{supabase_env, supabase_configured, http_get_json}`, `api.auth.AuthContext`.
- Produces: `fetch_supabase_health_data(auth) -> dict | None` — caller's row, else the demo row, else `None`; queries use the caller's JWT. `load_health_data(local_path=None, auth=None) -> dict | None` — when Supabase is configured, only Supabase (never the local file, never without a token); otherwise the local file exactly as before.

- [ ] **Step 1: Write the failing tests** — `tests/api/test_chat_core_data.py`

```python
import json

from api.auth import AuthContext
from api.chat_core import fetch_supabase_health_data, load_health_data


def test_user_gets_their_own_row(fake_supabase):
    ctx = AuthContext(user_id="user-a", token="token-a")
    assert fetch_supabase_health_data(ctx) == {"who": "a"}


def test_user_without_row_gets_demo(fake_supabase):
    fake_supabase["users"]["token-c"] = "user-c"
    ctx = AuthContext(user_id="user-c", token="token-c")
    assert fetch_supabase_health_data(ctx) == {"who": "demo"}


def test_no_row_and_no_demo_returns_none(fake_supabase):
    fake_supabase["users"]["token-c"] = "user-c"
    fake_supabase["demo"] = None
    ctx = AuthContext(user_id="user-c", token="token-c")
    assert fetch_supabase_health_data(ctx) is None


def test_queries_use_the_callers_jwt_not_the_anon_key(fake_supabase):
    fetch_supabase_health_data(AuthContext(user_id="user-a", token="token-a"))
    for url, headers in fake_supabase["calls"]:
        assert headers["Authorization"] == "Bearer token-a"
        assert headers["apikey"] == "anon-key"
        assert "limit=1" not in url


def test_never_requests_another_users_row(fake_supabase):
    fetch_supabase_health_data(AuthContext(user_id="user-a", token="token-a"))
    assert all("user-b" not in url for url, _ in fake_supabase["calls"])


def test_configured_without_auth_returns_none_and_skips_local_file(fake_supabase, tmp_path):
    local = tmp_path / "health_data.json"
    local.write_text(json.dumps({"who": "local"}))
    assert load_health_data(local_path=local) is None
    assert fake_supabase["calls"] == []


def test_configured_does_not_fall_back_to_local_file(fake_supabase, tmp_path):
    fake_supabase["users"]["token-c"] = "user-c"
    fake_supabase["demo"] = None
    local = tmp_path / "health_data.json"
    local.write_text(json.dumps({"who": "local"}))
    ctx = AuthContext(user_id="user-c", token="token-c")
    assert load_health_data(local_path=local, auth=ctx) is None


def test_local_dev_reads_local_file(no_supabase, tmp_path):
    local = tmp_path / "health_data.json"
    local.write_text(json.dumps({"who": "local"}))
    assert load_health_data(local_path=local) == {"who": "local"}


def test_local_dev_missing_file_returns_none(no_supabase, tmp_path):
    assert load_health_data(local_path=tmp_path / "missing.json") is None
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/api/test_chat_core_data.py -v`
Expected: FAIL (`fetch_supabase_health_data() takes 0 positional arguments but 1 was given`, and `test_configured_without_auth...` fails because the old code reads the local file).

- [ ] **Step 3: Implement** — in `api/chat_core.py`, add `import api.supabase_http as supabase_http` below the existing `from datetime import ...` import, then replace lines 47-86 (`fetch_supabase_health_data` and `load_health_data`) with:

```python
def fetch_supabase_health_data(auth):
    """Return the caller's own health data, else the shared demo data, else None.

    Queries run with the caller's JWT, so row-level security decides what is visible.
    """
    supabase_url, anon_key = supabase_http.supabase_env()
    if not supabase_url or auth is None or not auth.token or not auth.user_id:
        return None

    headers = {"apikey": anon_key, "Authorization": f"Bearer {auth.token}"}
    queries = [
        f"user_id=eq.{urllib.parse.quote(auth.user_id, safe='')}",
        "is_demo=eq.true",
    ]
    for query in queries:
        status, rows = supabase_http.http_get_json(
            f"{supabase_url}/rest/v1/health_data?select=data&{query}", headers
        )
        if status == 200 and rows:
            return rows[0].get("data")
    return None


def load_health_data(local_path=None, auth=None):
    # When Supabase is configured it is the only source: no anon reads, no local fallback.
    if supabase_http.supabase_configured():
        return fetch_supabase_health_data(auth)

    health_file = pathlib.Path(local_path) if local_path else ROOT / "health_data.json"
    if not health_file.exists():
        return None

    with open(health_file) as f:
        return json.load(f)
```

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests -v`
Expected: all tests PASS (Task 3 tests still green).

- [ ] **Step 5: Commit**

```bash
git add api/chat_core.py tests/api/test_chat_core_data.py
git commit -m "feat(api): load health data per user via the caller's JWT, with demo fallback"
```

---

### Task 5: Authenticated `/api/health` and `/api/chat`

**Files:**
- Modify: `api/health.py` (whole file), `api/chat.py:26-63`
- Create: `tests/api/test_handlers.py`

**Interfaces:**
- Consumes: `api.auth.{authenticate, AuthError}`, `api.chat_core.load_health_data(local_path=None, auth=None)`.
- Produces: both handlers return `401 {"error": "<message>"}` on `AuthError` before reading any data or calling any model; otherwise unchanged behavior. `_send_json(self, data, status=200)`.

- [ ] **Step 1: Write the failing tests** — `tests/api/test_handlers.py`

```python
import api.chat as chat_module
import api.health as health_module


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_health_requires_token(fake_supabase, call):
    status, body = call(health_module.handler)
    assert status == 401 and "error" in body


def test_health_rejects_bad_token(fake_supabase, call):
    status, _ = call(health_module.handler, headers=bearer("nope"))
    assert status == 401


def test_health_returns_only_callers_data(fake_supabase, call):
    status, body = call(health_module.handler, headers=bearer("token-a"))
    assert status == 200 and body == {"who": "a"}


def test_health_new_user_gets_demo(fake_supabase, call):
    fake_supabase["users"]["token-c"] = "user-c"
    status, body = call(health_module.handler, headers=bearer("token-c"))
    assert status == 200 and body == {"who": "demo"}


def test_health_local_dev_needs_no_token(no_supabase, call, monkeypatch):
    monkeypatch.setattr(health_module, "load_health_data", lambda auth=None: {"who": "local"})
    status, body = call(health_module.handler)
    assert status == 200 and body == {"who": "local"}


def test_health_no_data_message_preserved(fake_supabase, call):
    fake_supabase["users"]["token-c"] = "user-c"
    fake_supabase["demo"] = None
    status, body = call(health_module.handler, headers=bearer("token-c"))
    assert status == 200 and body == {"error": "No health data found."}


def test_chat_requires_token_and_never_calls_the_model(fake_supabase, call, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "server-key")
    calls = []
    monkeypatch.setattr(chat_module, "chat_with_claude", lambda *a, **k: calls.append(a) or "x")
    status, body = call(
        chat_module.handler, "POST", body={"message": "hi", "chatMode": "claude"}
    )
    assert status == 401 and "error" in body
    assert calls == []


def test_chat_uses_the_callers_own_data(fake_supabase, call, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "server-key")
    seen = {}

    def fake_claude(message, history, health_data, api_key, model):
        seen["health_data"] = health_data
        return "stub reply"

    monkeypatch.setattr(chat_module, "chat_with_claude", fake_claude)
    status, body = call(
        chat_module.handler,
        "POST",
        headers=bearer("token-b"),
        body={"message": "hi", "chatMode": "claude"},
    )
    assert status == 200 and body["reply"] == "stub reply"
    assert seen["health_data"] == {"who": "b"}
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/api/test_handlers.py -v`
Expected: FAIL (handlers return 200 / read the wrong data; `monkeypatch.setattr(health_module, "load_health_data", ...)` also needs the handler to accept `auth`).

- [ ] **Step 3: Implement** — `api/health.py` (full file):

```python
from http.server import BaseHTTPRequestHandler
import json

from api.auth import AuthError, authenticate
from api.chat_core import load_health_data


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            auth = authenticate(self.headers)
        except AuthError as e:
            self._send_json({"error": str(e)}, 401)
            return

        data = load_health_data(auth=auth)
        if data is None:
            data = {"error": "No health data found."}
        self._send_json(data)

    def _send_json(self, data, status=200):
        response = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def log_message(self, format, *args):
        pass
```

`api/chat.py`: add `from api.auth import AuthError, authenticate` after `import os`; then replace the start of `do_POST` and `_send_json`:

```python
    def do_POST(self):
        try:
            auth = authenticate(self.headers)
        except AuthError as e:
            self._send_json({"error": str(e)}, 401)
            return

        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))

        health_data = load_health_data(auth=auth)
```

(the rest of `do_POST` is unchanged), and:

```python
    def _send_json(self, data, status=200):
        response = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)
```

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests -v`
Expected: all tests PASS.

- [ ] **Step 5: Confirm local dev still imports cleanly**

Run: `python -c "import server"` (from the repo root)
Expected: no error (`server.py` still calls `load_health_data(local_path=...)`, which remains valid).

- [ ] **Step 6: Commit**

```bash
git add api/health.py api/chat.py tests/api/test_handlers.py
git commit -m "feat(api): require a verified Supabase session for /api/health and /api/chat"
```

---

### Task 6: Synthetic demo dataset generator

**Files:**
- Create: `scripts/make_demo_seed.py`, `tests/scripts/test_make_demo_seed.py`
- Create (generated): `supabase/seed_demo.sql`

**Interfaces:**
- Produces: `build_demo_health_data(days=120, end=date(2026, 9, 30), seed=42) -> dict` in the documented `HealthData` shape (`daily` dict keyed by ISO date, `summary`, `events`, `generated_at`); `build_seed_sql(data) -> str` (idempotent upsert of the demo row); `python scripts/make_demo_seed.py` writes `supabase/seed_demo.sql`.

- [ ] **Step 1: Write the failing tests** — `tests/scripts/test_make_demo_seed.py`

```python
from datetime import date

from scripts.make_demo_seed import build_demo_health_data, build_seed_sql

DAILY_KEYS = {
    "date", "steps", "resting_hr", "hrv", "sleep_hours",
    "active_calories", "exercise_minutes", "spo2",
}


def test_is_deterministic():
    assert build_demo_health_data() == build_demo_health_data()


def test_daily_shape_and_length():
    data = build_demo_health_data(days=30, end=date(2026, 9, 30))
    assert len(data["daily"]) == 30
    assert "2026-09-30" in data["daily"] and "2026-09-01" in data["daily"]
    for key, entry in data["daily"].items():
        assert set(entry) == DAILY_KEYS and entry["date"] == key


def test_values_are_plausible():
    for entry in build_demo_health_data()["daily"].values():
        assert 1000 <= entry["steps"] <= 30000
        assert 4 <= entry["sleep_hours"] <= 10
        assert 40 <= entry["resting_hr"] <= 90
        assert 0 < entry["hrv"] < 150


def test_summary_matches_daily():
    data = build_demo_health_data()
    daily = list(data["daily"].values())
    s = data["summary"]
    assert s["total_days"] == len(daily)
    assert s["best_sleep"] == max(d["sleep_hours"] for d in daily)
    assert s["worst_sleep"] == min(d["sleep_hours"] for d in daily)
    assert s["best_steps_day"] == max(daily, key=lambda d: d["steps"])["date"]
    assert s["avg_steps"] == round(sum(d["steps"] for d in daily) / len(daily))


def test_events_are_labeled_as_sample_data():
    data = build_demo_health_data()
    assert data["events"] and all("Sample" in e["label"] for e in data["events"])
    assert {"label", "start", "end", "color", "icon"} <= set(data["events"][0])


def test_seed_sql_is_an_idempotent_demo_upsert():
    sql = build_seed_sql({"note": "it's fine"})
    assert "insert into public.health_data (is_demo, data)" in sql
    assert "on conflict (is_demo) where is_demo do update" in sql
    assert "it''s fine" in sql  # single quotes escaped
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/scripts -v`
Expected: collection error `ModuleNotFoundError: No module named 'scripts'`.

- [ ] **Step 3: Implement** — `scripts/make_demo_seed.py` (with an empty `scripts/__init__.py`)

```python
"""Generate supabase/seed_demo.sql: a synthetic, deterministic demo dataset.

Run from the repo root:  python scripts/make_demo_seed.py
"""
import json
import pathlib
import random
from datetime import date, timedelta

ROOT = pathlib.Path(__file__).parent.parent


def build_demo_health_data(days=120, end=date(2026, 9, 30), seed=42):
    rng = random.Random(seed)
    daily = {}
    for i in range(days):
        key = (end - timedelta(days=days - 1 - i)).isoformat()
        daily[key] = {
            "date": key,
            "steps": int(min(25000, max(1500, rng.gauss(8000, 2200)))),
            "resting_hr": round(min(80, max(48, rng.gauss(61, 3))), 1),
            "hrv": round(min(100, max(20, rng.gauss(48, 8))), 1),
            "sleep_hours": round(min(10, max(4, rng.gauss(7.1, 0.9))), 2),
            "active_calories": int(max(100, rng.gauss(420, 90))),
            "exercise_minutes": int(max(0, rng.gauss(35, 15))),
            "spo2": round(min(100, max(94, rng.gauss(97.5, 0.6))), 1),
        }

    rows = list(daily.values())

    def avg(field):
        return sum(r[field] for r in rows) / len(rows)

    summary = {
        "avg_steps": round(avg("steps")),
        "avg_sleep_hours": round(avg("sleep_hours"), 1),
        "avg_resting_hr": round(avg("resting_hr"), 1),
        "avg_hrv": round(avg("hrv"), 1),
        "best_sleep": max(r["sleep_hours"] for r in rows),
        "worst_sleep": min(r["sleep_hours"] for r in rows),
        "best_steps_day": max(rows, key=lambda r: r["steps"])["date"],
        "total_days": len(rows),
    }
    exam_start = end - timedelta(days=20)
    events = [
        {
            "label": "Sample exam week",
            "start": exam_start.isoformat(),
            "end": (exam_start + timedelta(days=6)).isoformat(),
            "color": "#ef4444",
            "icon": "books",
        }
    ]
    return {
        "daily": daily,
        "summary": summary,
        "events": events,
        "generated_at": "2026-09-30T00:00:00",
    }


def build_seed_sql(data):
    payload = json.dumps(data, separators=(",", ":")).replace("'", "''")
    return (
        "-- Synthetic demo data. Generated by scripts/make_demo_seed.py; do not edit by hand.\n"
        "insert into public.health_data (is_demo, data)\n"
        f"values (true, '{payload}'::jsonb)\n"
        "on conflict (is_demo) where is_demo do update\n"
        "  set data = excluded.data, updated_at = now();\n"
    )


if __name__ == "__main__":
    out = ROOT / "supabase" / "seed_demo.sql"
    out.write_text(build_seed_sql(build_demo_health_data()), encoding="utf-8")
    print(f"Wrote {out}")
```

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest tests -v`
Expected: all tests PASS.

- [ ] **Step 5: Generate the seed and apply it to the scratch project**

```bash
python scripts/make_demo_seed.py
```
Paste `supabase/seed_demo.sql` into the scratch project's SQL editor and run it twice (idempotent). Then `select count(*) from public.health_data where is_demo;` → expected `1`. Re-run `supabase/tests/rls_check.sql` → expected `ALL RLS CHECKS PASSED` (the check inserts its own demo row inside the rolled-back transaction, so delete the seeded row first if the unique index complains: `delete from public.health_data where is_demo;`, then re-seed afterwards).

- [ ] **Step 6: Commit**

```bash
git add scripts supabase/seed_demo.sql tests/scripts
git commit -m "feat(db): deterministic synthetic demo dataset and seed SQL"
```

---

### Task 7: Patch the legacy `index.html`

**Files:**
- Modify: `index.html` (5 spots: helper before `// ── Auth ──`, `doReparse` ~line 1701, upload ~1902, `sendMessage` ~2144, `loadAppData` ~2285)

**Interfaces:**
- Consumes: global `supabaseClient` (set in `initSupabase`), `currentUser`.
- Produces: `async function authHeaders()` returning `{ Authorization: 'Bearer <access_token>' }` or `{}`.

There is no JS test harness for the legacy page (it is replaced in later plans); this task is verified manually in Task 9. Make the edits exactly:

- [ ] **Step 1: Add the helper.** Immediately above the line `// ── Auth ─────────────────────────────────────────────────` (before `async function initSupabase()`), insert:

```js
async function authHeaders() {
  if (!supabaseClient) return {};
  const { data: { session } } = await supabaseClient.auth.getSession();
  return session?.access_token ? { Authorization: 'Bearer ' + session.access_token } : {};
}

```

- [ ] **Step 2: Upload by `user_id`.** Replace

```js
    const { error } = await supabaseClient.from('health_data').upsert({ id: 1, data: result }, { onConflict: 'id' });
```
with
```js
    const { error } = await supabaseClient.from('health_data').upsert({ user_id: currentUser.id, data: result }, { onConflict: 'user_id' });
```

- [ ] **Step 3: Send the token on chat.** In `sendMessage`, replace

```js
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        message: msg,
```
with
```js
      method:'POST', headers:{'Content-Type':'application/json', ...(await authHeaders())},
      body: JSON.stringify({
        message: msg,
```

- [ ] **Step 4: Send the token when loading data.** In `loadAppData`, replace

```js
      fetch('/api/health'),
      fetch('/api/config')
```
with
```js
      authHeaders().then(h => fetch('/api/health', { headers: h })),
      fetch('/api/config')
```

- [ ] **Step 5: Keep the (unused) reparse path consistent.** In `doReparse`, replace `const hr = await fetch('/api/health');` with `const hr = await fetch('/api/health', { headers: await authHeaders() });`.

- [ ] **Step 6: Verify no stale call sites remain**

Run: `grep -n "id: 1\|onConflict: 'id'\|fetch('/api/health')" index.html`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "fix(legacy-ui): send Supabase token to the API and upsert by user_id"
```

---

### Task 8: CI

**Files:**
- Create: `.github/workflows/tests.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: tests
on:
  pull_request:
  push:
    branches: [master]
jobs:
  api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install -r requirements-dev.txt
      - run: python -m pytest -v
```

- [ ] **Step 2: Run the suite locally one last time**

Run: `python -m pytest -v`
Expected: all tests PASS.

- [ ] **Step 3: Commit and open the PR**

```bash
git add .github
git commit -m "ci: run pytest on pull requests"
git push -u origin feat/per-user-data
gh pr create --base master --title "Per-user health data and authenticated API (Step 0)" --body "Implements Step 0 of docs/superpowers/specs/2026-10-03-somada-modernization-design.md. Do not merge until the deploy checklist in the plan (Task 9) is ready: the migration and the code deploy must go out together."
```

---

### Task 9: Deploy and verify end to end (manual, requires a short maintenance window)

**Files:**
- None. This is the cutover checklist. Because the old frontend/API and the new schema are not mutually compatible, do steps 3-5 back to back, at a quiet time. Expect a few minutes of errors for anyone with the app open.

- [ ] **Step 1: Verify on a Vercel preview against the scratch project.** In Vercel, set the *Preview* environment's `SUPABASE_URL` / `SUPABASE_ANON_KEY` to the scratch project (and an `ANTHROPIC_API_KEY`). Open the PR's preview URL. Create two accounts (A and B).
  - A with no upload sees the demo banner and the synthetic demo data.
  - A uploads an `export.xml`; the dashboard shows A's data.
  - B signs in on another browser: B sees demo data, **not** A's data. B uploads; A still sees A's data (refresh).
  - Chat answers for A reference A's metrics.
  - In DevTools console, signed out: `fetch('/api/health').then(r => r.status)` → `401`.
  - In the Supabase SQL editor on scratch: `select user_id, is_demo from public.health_data;` → one row per account plus the demo row.

- [ ] **Step 2: Announce the short maintenance window** to the ~10 users (existing users will need to re-upload; their data was never stored per user).

- [ ] **Step 3: Apply `0002_per_user_health_data.sql` and then `supabase/seed_demo.sql` to production** (SQL editor).

- [ ] **Step 4: Merge the PR to `master`** so Vercel deploys production.

- [ ] **Step 5: Smoke test production** with two real accounts, repeating the Step 1 checks. Also confirm anonymous access is closed:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://somada.vercel.app/api/health
```
Expected: `401`.

- [ ] **Step 6: If something is badly broken**, run `supabase/rollback/0002_down.sql` and redeploy the previous Vercel deployment (Vercel dashboard → Deployments → previous → Promote). The legacy row (`id = 1`) was never deleted, so the old behavior returns.

- [ ] **Step 7 (optional): Assign the legacy row to its owner.** If row `id = 1` is yours, in the SQL editor: `update public.health_data set user_id = '<your auth.users id>' where id = 1;`. Otherwise leave it orphaned (invisible) or delete it after confirming your backup from Task 1.

---

## Self-Review

**Spec coverage (Step 0 section):**
- Migration with `user_id`, RLS scoped to `auth.uid()`, public read removed → Task 2.
- `api/auth.py` verifying `Authorization: Bearer <jwt>`, per-user reads, 401 on missing/invalid token, no `limit=1` fallback → Tasks 3-5 (the `limit=1` absence is asserted in `test_queries_use_the_callers_jwt_not_the_anon_key`).
- Legacy `index.html` minimally patched (token on API calls, upsert with `user_id`) → Task 7.
- Existing legacy row handling → Task 1 (backup) + Task 2 (orphan, non-destructive) + Task 9 Step 7.
- BYOK keys browser-only → untouched; `chat.py` still receives them per request and does not log them (`log_message` is a no-op).
- Demo behavior (a gap the spec did not cover, resolved with the user: dedicated synthetic demo row) → Tasks 2 and 6.
- `server.py` local dev unchanged → Task 5 Step 5.
- CI (spec "Testing and CI") → Task 8, pytest only; Vitest/Playwright arrive with `web/`.
- Deliberately deferred: per-user rate limiting on `/api/chat` (spec lists it under the API layer, not under Step 0) — add to the Step 2 plan.

**Placeholder scan:** none; every code step has complete code.

**Type consistency:** `AuthContext(user_id, token)`, `authenticate(headers)`, `AuthError`, `supabase_env()`, `supabase_configured()`, `http_get_json(url, headers, timeout)`, `load_health_data(local_path=None, auth=None)` and `fetch_supabase_health_data(auth)` are named identically in the interfaces, tests and implementations. The tests patch `api.supabase_http.http_get_json`, and both `auth.py` and `chat_core.py` call it via the `supabase_http.` module attribute so the patch takes effect.

**Known risks to watch during execution:** (1) the `auth.users` insert in `rls_check.sql` may need extra NOT NULL columns on some Supabase versions (called out in Task 2 Step 6); (2) the live schema may differ from the README (Task 1 gates this); (3) Vercel treats every `.py` under `api/` as a function, but `chat_core.py` already lives there without a handler and deploys fine, so `auth.py` and `supabase_http.py` follow the same pattern — confirm on the preview deploy in Task 9 Step 1.
