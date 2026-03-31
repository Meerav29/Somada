from http.server import BaseHTTPRequestHandler
import json
import os
import pathlib
import urllib.request
import urllib.error
import urllib.parse

ROOT = pathlib.Path(__file__).parent.parent

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
VERTEX_API_BASE = "https://aiplatform.googleapis.com/v1"


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


def build_system_prompt(health_data, events=None):
    summary = health_data.get("summary", {})
    if events is None:
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


def get_vertex_model():
    return os.environ.get("VERTEX_MODEL", "gemini-2.0-flash")


def extract_vertex_text(data):
    for candidate in data.get("candidates", []):
        parts = ((candidate.get("content") or {}).get("parts") or [])
        text = "".join(part.get("text", "") for part in parts if part.get("text")).strip()
        if text:
            return text

        finish_reason = candidate.get("finishReason") or candidate.get("finish_reason")
        if finish_reason == "SAFETY":
            return "Vertex AI blocked the response for safety reasons."

    prompt_feedback = data.get("promptFeedback") or data.get("prompt_feedback") or {}
    block_reason = prompt_feedback.get("blockReason") or prompt_feedback.get("block_reason")
    if block_reason:
        return f"Vertex AI blocked this prompt ({block_reason})."

    return "Vertex AI returned an empty response."


def chat_with_vertex(message, history, health_data, api_key, model):
    if not api_key:
        return "Error: VERTEX_API_KEY not set."

    contents = []
    for h in history:
        content = (h.get("content") or "").strip()
        if not content:
            continue
        role = "model" if h.get("role") == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": content}]})
    contents.append({"role": "user", "parts": [{"text": message}]})

    payload = {
        "systemInstruction": {"parts": [{"text": build_system_prompt(health_data)}]},
        "contents": contents,
        "generationConfig": {"maxOutputTokens": 1024},
    }

    model_path = f"publishers/google/models/{urllib.parse.quote(model, safe='')}:generateContent"
    url = f"{VERTEX_API_BASE}/{model_path}?{urllib.parse.urlencode({'key': api_key})}"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return extract_vertex_text(json.loads(resp.read()))
    except urllib.error.HTTPError as e:
        return f"API Error {e.code}: {e.read().decode()}"
    except Exception as e:
        return f"Error: {str(e)}"


def resolve_chat_api_key(body):
    mode = body.get("chatMode", "server")
    if mode == "byok":
        return (body.get("vertexApiKey") or "").strip(), "byok"
    return os.environ.get("VERTEX_API_KEY", "").strip(), "server"


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
        events   = body.get("events", None)
        api_key, mode = resolve_chat_api_key(body)
        model = get_vertex_model()

        if events is not None:
            health_data = dict(health_data)
            health_data["events"] = events

        if mode == "byok" and not api_key:
            reply = "Add your Vertex AI API key in Settings before using your own key."
        else:
            reply = chat_with_vertex(message, history, health_data, api_key, model)

        self._send_json({"reply": reply, "mode": mode, "model": model})

    def _send_json(self, data):
        response = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def log_message(self, format, *args):
        pass
