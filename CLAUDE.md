# Somada - Agent Context

Somada is a personal Apple Health dashboard. It visualizes steps, sleep, HRV, heart rate, and related trends, and it includes an AI chat experience backed by Vertex AI.

The deployed app runs on Vercel and uses Supabase for auth plus stored health data. The local development path uses `server.py` and `health_data.json`.

---

## File Structure

```text
health-dashboard/
|- index.html              # Entire frontend, single-file vanilla JS app
|- server.py               # Local-only HTTP server
|- parse_health.py         # Local-only Apple Health XML parser
|- vercel.json             # SPA rewrites for Vercel
|- .env                    # Local env vars (gitignored)
`- api/
   |- health.py            # GET /api/health
   |- chat.py              # POST /api/chat
   |- config.py            # GET /api/config
   `- supabase_config.py   # GET /api/supabase_config
```

---

## Deployment Modes

### Vercel

- `api/*.py` are Vercel Python serverless functions.
- Data is loaded from Supabase.
- Upload parsing happens in the browser, not on the server.

### Local dev

- `python parse_health.py export.xml` generates `health_data.json`.
- `python server.py` serves the app at `http://localhost:8080`.
- `server.py` mirrors the main `/api/*` routes for local testing only.

---

## Environment Variables

| Variable | Used by | Purpose |
|---|---|---|
| `SUPABASE_URL` | `api/health.py`, `api/chat.py`, `api/supabase_config.py` | Supabase project URL |
| `SUPABASE_ANON_KEY` | same as above | Supabase anon public key |
| `VERTEX_API_KEY` | `api/chat.py`, `server.py` | Shared server-side Vertex AI key |
| `VERTEX_MODEL` | `api/chat.py`, `server.py` | Optional model override, defaults to `gemini-2.0-flash` |

Users can also save their own Vertex AI API key in the browser from Settings. The frontend stores it in localStorage and includes it with chat requests when the user selects the BYOK mode.

---

## Supabase

### Auth

- Email/password auth via Supabase JS.
- `initSupabase()` in `index.html` initializes the client, checks session state, and shows the auth overlay when needed.
- `currentUser` is the actual auth guard. Do not use `supabaseClient` as an auth check.

### Database

Single table:

```sql
CREATE TABLE health_data (
  id integer PRIMARY KEY DEFAULT 1,
  data jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE health_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_public_read" ON health_data
  FOR SELECT USING (true);

CREATE POLICY "allow_auth_write" ON health_data
  FOR ALL USING (auth.role() = 'authenticated');
```

---

## Health Data Shape

The frontend and chat prompt expect this structure:

```json
{
  "daily": {
    "2025-01-15": {
      "date": "2025-01-15",
      "steps": 8500,
      "resting_hr": 62.5,
      "hrv": 45.3,
      "sleep_hours": 7.25,
      "active_calories": 350,
      "exercise_minutes": 45,
      "spo2": 97.8
    }
  },
  "summary": {
    "avg_steps": 9247,
    "avg_sleep_hours": 7.1,
    "avg_resting_hr": 61.8,
    "avg_hrv": 48.2,
    "best_sleep": 9.5,
    "worst_sleep": 4.2,
    "best_steps_day": "2025-02-14",
    "total_days": 241
  },
  "events": [
    { "label": "Finals Week", "start": "2025-04-28", "end": "2025-05-05", "color": "#ef4444", "icon": "books" }
  ],
  "generated_at": "2025-02-26T15:32:11.123456"
}
```

`daily` is a dictionary keyed by date string, not an array.

---

## API Endpoints

### `GET /api/health`

Loads the parsed health JSON. Vercel prefers Supabase and falls back to local `health_data.json`.

### `POST /api/chat`

Body:

```json
{
  "message": "How did finals week affect my sleep?",
  "history": [{ "role": "user", "content": "..." }],
  "chatMode": "server",
  "vertexApiKey": "",
  "events": []
}
```

- Builds a system prompt from the health data.
- Sends the request to Vertex AI.
- Uses `VERTEX_API_KEY` when `chatMode` is `server`.
- Uses the supplied `vertexApiKey` when `chatMode` is `byok`.

### `GET /api/config`

Returns the current chat configuration:

```json
{
  "chat": {
    "serverVertex": true,
    "serverModel": "gemini-2.0-flash",
    "byokSupported": true
  }
}
```

### `GET /api/supabase_config`

Returns `{ url, anonKey }` for frontend initialization.

---

## Frontend Notes

- `index.html` is the whole app.
- `chatConfig` tracks whether the shared server-side Vertex key is available and which model is configured.
- `currentChatMode` is either `server` or `byok`.
- The Settings page is where users choose between Somada AI and their own Vertex key.
- The Insights page no longer exposes provider switching.

---

## Common Pitfalls

- `server.py` changes do not affect Vercel. Update `api/*.py` for production behavior.
- `LIFE_EVENTS` is duplicated between `parse_health.py` and `index.html`. Keep them in sync.
- Upload parsing is browser-side. Do not add large server-side upload flows for Vercel.
- If you change how health data is fetched, update both `api/health.py` and the local-dev path in `server.py` if needed.
