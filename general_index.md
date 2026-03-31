# Somada - General File Index

Short descriptions of the main files in this repo.

---

## Root

| File | Description |
|---|---|
| [index.html](index.html) | The entire frontend. Single-file vanilla JS app using Chart.js and the Supabase JS client. Includes the Settings UI for choosing Somada AI or a user-provided Vertex AI key. |
| [server.py](server.py) | Local-only HTTP server for development. Serves the SPA and mirrors the `/api/*` routes outside Vercel. |
| [parse_health.py](parse_health.py) | Local-only Apple Health XML parser that produces `health_data.json`. |
| [README.md](README.md) | Human-facing setup and usage instructions. |
| [CLAUDE.md](CLAUDE.md) | Internal project context document for coding agents. |
| [.env](.env) | Local environment variables, typically `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VERTEX_API_KEY`, and optionally `VERTEX_MODEL`. |
| [vercel.json](vercel.json) | Vercel rewrite config for the SPA. |

---

## `api/`

| File | Description |
|---|---|
| [api/health.py](api/health.py) | `GET /api/health` - loads parsed health data from Supabase, with a local-file fallback. |
| [api/chat.py](api/chat.py) | `POST /api/chat` - builds the health-context system prompt and sends chat requests to Vertex AI using either the server key or a user-supplied Vertex key. |
| [api/config.py](api/config.py) | `GET /api/config` - returns the current chat configuration, including whether the server-side Vertex key is configured and which model is in use. |
| [api/supabase_config.py](api/supabase_config.py) | `GET /api/supabase_config` - exposes Supabase public config to the frontend. |
