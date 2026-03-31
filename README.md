# Somada

A personal health analytics dashboard powered by Apple Health data plus Vertex AI chat. It visualizes sleep, steps, heart rate, and HRV with life events annotated on charts.

---

## Deployed (Vercel)

This is the primary setup. Data lives in Supabase and the app is hosted on Vercel. Uploading your health data happens entirely in the browser.

### Prerequisites

- [Vercel](https://vercel.com)
- [Supabase](https://supabase.com)
- A Vertex AI API key from Google Cloud

### 1. Create the Supabase table

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

### 2. Configure Vercel env vars

Set these in your Vercel project:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon public key |
| `VERTEX_API_KEY` | Server-side Vertex AI key for the shared "Somada AI" mode |
| `VERTEX_MODEL` | Optional. Defaults to `gemini-2.5-flash` |

`VERTEX_API_KEY` is optional if you only want charts. If you do not set it, users can still use chat by saving their own Vertex AI API key in Settings.

### 3. Create your account

Open the deployed app and sign up with Supabase auth.

### 4. Upload Apple Health data

On your iPhone:

> Health app -> profile picture -> Export All Health Data

Unzip the export and upload `export.xml` in the app. Parsing runs in the browser and then saves to Supabase.

### 5. Update life events

Update `LIFE_EVENTS` in both `parse_health.py` and `index.html`, then re-upload `export.xml`.

---

## Local development

### 1. Set Vertex AI env vars

Windows Command Prompt:

```bat
set VERTEX_API_KEY=your_key_here
set VERTEX_MODEL=gemini-2.5-flash
```

Windows PowerShell:

```powershell
$env:VERTEX_API_KEY="your_key_here"
$env:VERTEX_MODEL="gemini-2.5-flash"
```

Or create a `.env` file:

```dotenv
VERTEX_API_KEY=your_key_here
VERTEX_MODEL=gemini-2.5-flash
```

### 2. Parse your health data

```bash
python parse_health.py export.xml
```

This creates `health_data.json`.

### 3. Start the dashboard

```bash
python server.py
```

Open `http://localhost:8080`.

---

## Vertex AI notes

- The app now uses Vertex AI only. Claude and Gemini provider switching has been removed.
- The shared backend mode uses `VERTEX_API_KEY`.
- Users can optionally save their own Vertex AI API key in Settings and route chat through that key instead.
- Google documents two API-key paths for Vertex AI: an express-mode API key, or a standard Google Cloud API key that is bound to a service account. If your key is neither, use ADC instead.

---

## Features

- Dashboard views for steps, sleep, resting HR, and HRV
- Browser-side Apple Health parsing and upload
- AI chat over your health data using Vertex AI
- Life-event annotations across charts and AI context
