# Somada

A personal health analytics dashboard powered by Apple Health data + AI chat (Claude or Gemini). Visualizes 8+ months of sleep, steps, heart rate, and HRV with life events annotated on charts.

---

## Deployed (Vercel) — primary setup

This is the recommended way to run Somada. Data lives in Supabase and the app is hosted on Vercel. Uploading your health data works entirely through the browser — no local Python needed.

### Prerequisites
- [Vercel](https://vercel.com) account (free tier works)
- [Supabase](https://supabase.com) account (free tier works)
- At least one AI API key: [Anthropic (Claude)](https://console.anthropic.com) or [Google (Gemini)](https://aistudio.google.com/app/apikey)

### 1. Create the Supabase table

In your Supabase project → **SQL Editor**, run:

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

### 2. Deploy to Vercel

Fork or push this repo to GitHub, then import it in Vercel. Set the following environment variables in your Vercel project settings:

| Variable | Where to get it |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon public key |
| `CLAUDE_API_KEY` | https://console.anthropic.com |
| `GEMINI_API_KEY` | https://aistudio.google.com/app/apikey |

At least one of `CLAUDE_API_KEY` or `GEMINI_API_KEY` is required for the chat feature. Both are optional if you only want the charts.

### 3. Create your account

Open your deployed Vercel URL. You'll see a sign-in screen — click **Sign up** to create an account using your Supabase auth credentials.

### 4. Upload your Apple Health data

On your iPhone:
> **Health** app → tap your profile picture (top right) → **Export All Health Data**

Share the ZIP to your computer and unzip it. You'll find `export.xml` inside.

In the app, go to the **Upload** page and drop in `export.xml`. Parsing runs entirely in your browser — no file size limits from the server. A 300 MB export typically takes 20–40 seconds to parse and save.

> **Note:** you need to be signed in before uploading. The upload page is accessible but the save will fail if you're logged out.

### 5. Updating your life events

Open `parse_health.py` and edit the `LIFE_EVENTS` list at the top with your actual dates (finals weeks, breaks, travel, etc.). Then make the **identical change** to the `LIFE_EVENTS` constant near the top of the `<script>` section in `index.html`. Re-upload your `export.xml` to apply the changes.

---

## Local development

For running the dashboard locally without Vercel or Supabase.

### 1. Set API keys

**Windows Command Prompt:**
```
set CLAUDE_API_KEY=your_key_here
set GEMINI_API_KEY=your_key_here
```

**Windows PowerShell:**
```
$env:CLAUDE_API_KEY="your_key_here"
```

Or create a `.env` file in the project root:
```
CLAUDE_API_KEY=your_key_here
GEMINI_API_KEY=your_key_here
```

### 2. Parse your health data

Export `export.xml` from your iPhone (same steps as above), place it in the project folder, then run:

```
python parse_health.py export.xml
```

This creates `health_data.json`. Takes 1–3 minutes for large files. Edit `LIFE_EVENTS` at the top of `parse_health.py` before running if you want your calendar annotated.

### 3. Start the dashboard

```
python server.py
```

Open **http://localhost:8080** — no login required in local mode.

> The local server reads directly from `health_data.json` and does not use Supabase.

---

## Features

- **Dashboard** — 30-day and 6-month overviews of steps, sleep, resting HR, and HRV
- **Sleep** — nightly sleep hours charted with HRV overlay
- **Activity** — daily steps and calories, monthly step totals
- **Recovery** — resting heart rate and HRV trends
- **Insights** — 30-day vs prior-30-day comparisons across all metrics
- **AI Chat** — ask Claude or Gemini anything about your data, with your full history as context
- **Life events** — academic calendar events annotated on all charts

## Example questions for the AI

- "How did finals week affect my sleep and recovery?"
- "Which month had my best HRV?"
- "Was there a trend in my resting heart rate over the semester?"
- "How did spring break compare to a typical week?"
- "What's the correlation between my step count and sleep quality?"
