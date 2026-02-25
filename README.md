# Meerav's Health Intelligence Dashboard

A personal health analytics dashboard powered by Apple Health data + Claude AI.

## Setup (5 minutes)

### 1. Export your Apple Health data
On your iPhone:
> Health app → tap profile picture (top right) → Export All Health Data

AirDrop the ZIP to your Windows PC. Unzip it — you'll find `export.xml`.

### 2. Put your files together
Create a folder anywhere on your PC and put these files in it:
```
health-dashboard/
  parse_health.py
  server.py
  index.html
  export.xml          ← your Apple Health export
```

### 3. Set your API key
Open a terminal and run:

**Windows (Command Prompt):**
```
set CLAUDE_API_KEY=your_key_here
```

**Windows (PowerShell):**
```
$env:CLAUDE_API_KEY="your_key_here"
```

Get your key at: https://console.anthropic.com

### 4. Parse your health data
```
python parse_health.py export.xml
```
This creates `health_data.json`. Takes 1-3 minutes for large files.

### 5. Update your life events
Open `parse_health.py` and edit the `LIFE_EVENTS` list at the top
to match your actual dates (finals weeks, breaks, travel, etc.)

Re-run `python parse_health.py export.xml` after editing.

### 6. Start the dashboard
```
python server.py
```

Then open: **http://localhost:8080**

## What you'll see
- 6 months of sleep, steps, heart rate, and HRV charted over time
- Life events annotated on the charts (finals weeks, breaks, etc.)
- AI chat powered by Claude — ask anything about your data

## Example questions to ask
- "How did finals week affect my sleep and recovery?"
- "Which month had my best HRV?"
- "Was there a trend in my resting heart rate over the semester?"
- "How did spring break compare to a typical week?"
