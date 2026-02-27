from http.server import BaseHTTPRequestHandler
import json
import os
import pathlib
import urllib.request
import urllib.error

ROOT = pathlib.Path(__file__).parent.parent

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")


def fetch_from_supabase():
    url = f"{SUPABASE_URL}/rest/v1/health_data?select=data&limit=1"
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
    })
    try:
        with urllib.request.urlopen(req) as resp:
            rows = json.loads(resp.read())
            if rows:
                return rows[0]["data"]
    except Exception:
        pass
    return None


def fetch_from_local():
    health_file = ROOT / "health_data.json"
    if not health_file.exists():
        return None
    with open(health_file) as f:
        return json.load(f)


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if SUPABASE_URL and SUPABASE_ANON_KEY:
            data = fetch_from_supabase()
        else:
            data = fetch_from_local()

        if data is None:
            data = {"error": "No health data found."}

        self._send_json(data)

    def _send_json(self, data):
        response = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def log_message(self, format, *args):
        pass
