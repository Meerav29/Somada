# Somada

A personal health analytics dashboard powered by Apple Health data plus Vertex AI and Claude chat. It visualizes sleep, steps, heart rate, and HRV with life events annotated on charts.

---

## Two ways to use it

### Try it — hosted on Vercel

Want to explore without setting anything up? Use the hosted version at [somada.app](https://somada.app).

- Sign up with email, upload your `export.xml`, and your data is parsed entirely in the browser before being saved to your account in Supabase.
- AI chat (Gemini and Claude) is available out of the box — no API key needed.
- You can also bring your own Vertex AI or Anthropic key in Settings if you prefer to route chat through your own account.

**Data note:** your health data is stored in a shared Supabase instance. If you want your data to never leave your own infrastructure, use the self-hosted path below.

---

### Self-host — full privacy and control

The repo is open source. Fork or clone it and run everything yourself. Your data stays on your own Supabase project and your own Vercel deployment (or any other host).

#### 1. Create the Supabase table

Run this in your Supabase SQL editor:

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

#### 2. Deploy to Vercel

Fork the repo and import it into Vercel. Set these environment variables in your Vercel project:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon public key |
| `VERTEX_API_KEY` | Server-side Vertex AI key for shared "Somada AI" mode (optional) |
| `VERTEX_MODEL` | Optional. Defaults to `gemini-2.5-flash` |
| `ANTHROPIC_API_KEY` | Server-side Claude key for shared Claude mode (optional) |
| `CLAUDE_MODEL` | Optional. Defaults to `claude-sonnet-4-6` |

Both AI keys are optional — if you skip them, users can still chat by saving their own key in Settings (BYOK).

#### 3. Create your account

Open your deployed app and sign up with Supabase auth.

#### 4. Upload Apple Health data

On your iPhone:

> Health app → profile picture → Export All Health Data

Unzip the export and upload `export.xml` in the app. Parsing runs in the browser and then saves to your Supabase.

#### 5. Update life events

Edit the `LIFE_EVENTS` array in `index.html` (and `parse_health.py` if using local dev), then re-upload `export.xml`.

---

## Local development

Run the app entirely on your machine — no Supabase or Vercel account needed.

#### 1. Set env vars

Windows Command Prompt:

```bat
set VERTEX_API_KEY=your_key_here
set ANTHROPIC_API_KEY=your_key_here
```

Windows PowerShell:

```powershell
$env:VERTEX_API_KEY="your_key_here"
$env:ANTHROPIC_API_KEY="your_key_here"
```

Or create a `.env` file:

```dotenv
VERTEX_API_KEY=your_key_here
ANTHROPIC_API_KEY=your_key_here
```

#### 2. Parse your health data

```bash
python parse_health.py export.xml
```

This creates `health_data.json`.

#### 3. Start the dashboard

```bash
python server.py
```

Open `http://localhost:8080`.

---

## Features

- Dashboard views for steps, sleep, resting HR, and HRV
- Browser-side Apple Health XML parsing — data never touches a server during upload
- AI chat over your health data using Vertex AI (Gemini) or Claude
- Bring your own API key (Vertex or Anthropic) via Settings
- Life-event annotations across charts and AI context
