from http.server import BaseHTTPRequestHandler
import json
import os
import pathlib
import urllib.request
import urllib.error

ROOT = pathlib.Path(__file__).parent.parent

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")


def load_health_data():
    if SUPABASE_URL and SUPABASE_ANON_KEY:
        try:
            url = f"{SUPABASE_URL}/rest/v1/health_data?select=data&limit=1"
            req = urllib.request.Request(url, headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
            })
            with urllib.request.urlopen(req) as resp:
                rows = json.loads(resp.read())
                if rows:
                    return rows[0]["data"]
        except Exception:
            pass
    health_file = ROOT / "health_data.json"
    if not health_file.exists():
        return None
    with open(health_file) as f:
        return json.load(f)


def build_system_prompt(health_data):
    summary = health_data.get("summary", {})
    events = health_data.get("events", [])
    daily = health_data.get("daily", {})

    daily_list = list(daily.values())[-90:]

    events_str = "\n".join([
        f"- {e['label']}: {e['start']} to {e['end']}"
        for e in events
    ])

    sleep_days = [(d["date"], d["sleep_hours"]) for d in daily_list if d.get("sleep_hours")]
    step_days  = [(d["date"], d["steps"])       for d in daily_list if d.get("steps")]

    worst_sleep = min(sleep_days, key=lambda x: x[1]) if sleep_days else None
    best_sleep  = max(sleep_days, key=lambda x: x[1]) if sleep_days else None
    best_steps  = max(step_days,  key=lambda x: x[1]) if step_days  else None

    recent = daily_list[-14:]
    recent_table = "Date | Steps | Sleep(h) | Resting HR | HRV\n" + "-" * 55 + "\n"
    for d in recent:
        recent_table += f"{d['date']} | {d.get('steps') or 'N/A'} | {d.get('sleep_hours') or 'N/A'} | {d.get('resting_hr') or 'N/A'} | {d.get('hrv') or 'N/A'}\n"

    return f"""You are an AI health analyst for Meerav Shah, a college student at Penn State.
You have access to 6+ months of his wearable health data from an Amazfit Helio Strap synced to Apple Health.

OVERALL STATS (last 6 months):
- Average steps/day: {summary.get('avg_steps', 'N/A'):,} steps
- Average sleep: {summary.get('avg_sleep_hours', 'N/A')} hours
- Average resting heart rate: {summary.get('avg_resting_hr', 'N/A')} bpm
- Average HRV: {summary.get('avg_hrv', 'N/A')} ms
- Total days of data: {summary.get('total_days', 'N/A')}
- Best sleep night: {best_sleep[1] if best_sleep else 'N/A'}h on {best_sleep[0] if best_sleep else 'N/A'}
- Worst sleep night: {worst_sleep[1] if worst_sleep else 'N/A'}h on {worst_sleep[0] if worst_sleep else 'N/A'}
- Most active day: {best_steps[1] if best_steps else 'N/A'} steps on {best_steps[0] if best_steps else 'N/A'}

LIFE EVENTS TIMELINE:
{events_str}

RECENT 14 DAYS:
{recent_table}

IMPORTANT CONTEXT:
- Meerav is a college student so his patterns are heavily influenced by academic calendar
- He uses an Amazfit Helio Strap which tracks biocharge (recovery score) and exertion
- He is health-optimized and actively tracks metrics to improve performance
- During finals weeks, expect reduced sleep and steps
- During breaks, expect improved recovery metrics

Answer questions conversationally and insightfully. Point out interesting patterns and correlations.
When you notice a trend, explain what it likely means physiologically.
Keep answers concise but specific - reference actual dates and numbers when relevant.
If asked something you don't have data for, say so clearly."""


def chat_with_claude(message, history, health_data):
    api_key = os.environ.get("CLAUDE_API_KEY", "")
    if not api_key:
        return "Error: CLAUDE_API_KEY not set."

    messages = [{"role": h["role"], "content": h["content"]} for h in history]
    messages.append({"role": "user", "content": message})

    payload = {
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 1024,
        "system": build_system_prompt(health_data),
        "messages": messages,
    }

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())["content"][0]["text"]
    except urllib.error.HTTPError as e:
        return f"API Error {e.code}: {e.read().decode()}"
    except Exception as e:
        return f"Error: {str(e)}"


def chat_with_gemini(message, history, health_data):
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        return "Error: GEMINI_API_KEY not set."

    contents = []
    for h in history:
        role = "model" if h["role"] == "assistant" else h["role"]
        contents.append({"role": role, "parts": [{"text": h["content"]}]})
    contents.append({"role": "user", "parts": [{"text": message}]})

    payload = {
        "system_instruction": {"parts": [{"text": build_system_prompt(health_data)}]},
        "contents": contents,
        "generationConfig": {"maxOutputTokens": 1024},
    }

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())["candidates"][0]["content"]["parts"][0]["text"]
    except urllib.error.HTTPError as e:
        return f"API Error {e.code}: {e.read().decode()}"
    except Exception as e:
        return f"Error: {str(e)}"


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))

        health_data = load_health_data()
        if not health_data:
            self._send_json({"reply": "No health data available."})
            return

        message  = body.get("message", "")
        history  = body.get("history", [])
        provider = body.get("provider", "claude")

        if provider == "gemini":
            reply = chat_with_gemini(message, history, health_data)
        else:
            reply = chat_with_claude(message, history, health_data)

        self._send_json({"reply": reply, "provider": provider})

    def _send_json(self, data):
        response = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def log_message(self, format, *args):
        pass
