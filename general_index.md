# Somada — General File Index

A one- or two-line description of every file in the repository (excluding `.git` internals).

---

## Root

| File | Description |
|------|-------------|
| [index.html](index.html) | The entire frontend — a single-file vanilla JS app (~1750 lines) using Chart.js and the Supabase JS client (no build step). The dashboard page uses a bento grid layout; all type is set in Inter via Google Fonts. |
| [vercel.json](vercel.json) | Vercel deployment config; rewrites every non-`/api/*` request to `index.html` so the SPA handles client-side routing. |
| [server.py](server.py) | Local-development-only HTTP server (`ThreadedHTTPServer`) that serves `index.html` and all `/api/*` routes from a single process — not used on Vercel. |
| [parse_health.py](parse_health.py) | Local-development-only CLI that parses an Apple Health `export.xml` file into the `health_data.json` structure consumed by the app; the authoritative source for parser logic that is mirrored in `index.html`. |
| [CLAUDE.md](CLAUDE.md) | Agent context document covering architecture, file structure, deployment modes, data shapes, common pitfalls, and environment variables — read by Claude Code at the start of every session. |
| [README.md](README.md) | Human-facing project documentation with setup and usage instructions. |
| [.gitignore](.gitignore) | Excludes Apple Health XML exports, Python caches, `.env`, and OS junk files from version control. |
| [.env](.env) | Local environment variables (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `CLAUDE_API_KEY`, `GEMINI_API_KEY`) — gitignored, mirrored as Vercel project settings in production. |
| [export.xml](export.xml) | Raw Apple Health data export (XML); gitignored but may exist locally as input for `parse_health.py`. |
| [export_cda.xml](export_cda.xml) | Apple Health CDA (Clinical Document Architecture) companion export; gitignored, not parsed by the app. |

---

## `api/` — Vercel Serverless Functions

Each file exports a class `handler(BaseHTTPRequestHandler)` — one file per route, no framework.

| File | Description |
|------|-------------|
| [api/health.py](api/health.py) | `GET /api/health` — fetches the full parsed health JSON from Supabase (falling back to local `health_data.json`) and returns it to the frontend. |
| [api/chat.py](api/chat.py) | `POST /api/chat` — loads health data the same way as `health.py`, builds a system prompt, and proxies the conversation to Claude (`claude-sonnet-4-20250514`) or Gemini (`gemini-2.0-flash`) based on the requested provider. |
| [api/config.py](api/config.py) | `GET /api/config` — returns `{ providers: { claude: bool, gemini: bool } }` so the frontend knows which AI providers are available. |
| [api/supabase_config.py](api/supabase_config.py) | `GET /api/supabase_config` — returns the Supabase project URL and anon key from environment variables so the frontend can initialise the Supabase JS client without baking secrets into `index.html`. |
