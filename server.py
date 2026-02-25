"""
Health Dashboard Backend
Serves health data and proxies Claude API for the AI chat.
Usage: python server.py
"""

from http.server import HTTPServer, SimpleHTTPRequestHandler
import json
import os
import urllib.request
import urllib.error
from datetime import datetime

CLAUDE_API_KEY = os.environ.get("CLAUDE_API_KEY", "")
HEALTH_DATA_FILE = "health_data.json"

def load_health_data():
    if not os.path.exists(HEALTH_DATA_FILE):
        return None
    with open(HEALTH_DATA_FILE) as f:
        return json.load(f)

def build_system_prompt(health_data):
    summary = health_data.get("summary", {})
    events = health_data.get("events", [])
    daily = health_data.get("daily", {})

    # Build a condensed data summary for the AI
    daily_list = list(daily.values())[-90:]  # last 90 days for context

    events_str = "\n".join([
        f"- {e['label']}: {e['start']} to {e['end']}"
        for e in events
    ])

    # Find interesting patterns
    sleep_days = [(d["date"], d["sleep_hours"]) for d in daily_list if d.get("sleep_hours")]
    step_days = [(d["date"], d["steps"]) for d in daily_list if d.get("steps")]

    worst_sleep = min(sleep_days, key=lambda x: x[1]) if sleep_days else None
    best_sleep = max(sleep_days, key=lambda x: x[1]) if sleep_days else None
    best_steps = max(step_days, key=lambda x: x[1]) if step_days else None

    # Recent 14 days as a table for context
    recent = daily_list[-14:]
    recent_table = "Date | Steps | Sleep(h) | Resting HR | HRV\n"
    recent_table += "-" * 55 + "\n"
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
    if not CLAUDE_API_KEY:
        return "Error: CLAUDE_API_KEY not set. Please set your API key in the .env file."

    system_prompt = build_system_prompt(health_data)

    messages = []
    for h in history:
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": message})

    payload = {
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 1024,
        "system": system_prompt,
        "messages": messages
    }

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "x-api-key": CLAUDE_API_KEY,
            "anthropic-version": "2023-06-01"
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
            return data["content"][0]["text"]
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        return f"API Error {e.code}: {error_body}"
    except Exception as e:
        return f"Error: {str(e)}"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        self.health_data = load_health_data()
        super().__init__(*args, directory=os.getcwd(), **kwargs)

    def log_message(self, format, *args):
        pass  # suppress default logs

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/health":
            self.send_json(self.health_data if self.health_data else {"error": "No health data found. Run parse_health.py first."})
        elif self.path == "/" or self.path == "/index.html":
            self.path = "/index.html"
            super().do_GET()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/api/chat":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            message = body.get("message", "")
            history = body.get("history", [])

            if not self.health_data:
                self.send_json({"reply": "No health data loaded. Please run parse_health.py first."})
                return

            reply = chat_with_claude(message, history, self.health_data)
            self.send_json({"reply": reply})
        else:
            self.send_response(404)
            self.end_headers()

    def send_json(self, data):
        response = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(response))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(response)


if __name__ == "__main__":
    port = 8080
    print(f"""
╔══════════════════════════════════════════╗
║   Meerav's Health Dashboard Server      ║
╚══════════════════════════════════════════╝

Starting on http://localhost:{port}

Make sure you have:
  1. Run parse_health.py to generate health_data.json
  2. Set CLAUDE_API_KEY environment variable

""")
    server = HTTPServer(("", port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
