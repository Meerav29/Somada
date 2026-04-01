"""
Somada Backend
Serves health data and proxies Vertex AI for the AI chat.
Usage: python server.py
"""

from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn
import json
import os
import subprocess
import sys


def load_env(path=".env"):
    """Load KEY=value pairs from a .env file into os.environ."""
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


load_env()

from api.chat_core import chat_with_vertex, get_vertex_model, load_health_data  # noqa: E402


HEALTH_DATA_FILE = "health_data.json"


def resolve_chat_api_key(body):
    mode = body.get("chatMode", "server")
    if mode == "byok":
        return (body.get("vertexApiKey") or "").strip(), "byok"
    return os.environ.get("VERTEX_API_KEY", "").strip(), "server"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        self.health_data = load_health_data(local_path=HEALTH_DATA_FILE)
        super().__init__(*args, directory=os.getcwd(), **kwargs)

    def log_message(self, format, *args):
        pass

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/health":
            self.send_json(self.health_data if self.health_data else {"error": "No health data found. Run parse_health.py first."})
        elif self.path == "/api/config":
            self.send_json({
                "chat": {
                    "serverVertex": bool(os.environ.get("VERTEX_API_KEY")),
                    "serverModel": get_vertex_model(),
                    "byokSupported": True,
                }
            })
        elif self.path == "/" or self.path == "/index.html":
            self.path = "/index.html"
            super().do_GET()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/api/reparse":
            if not os.path.exists("export.xml"):
                self.send_json({"ok": False, "error": "export.xml not found. Upload it first."})
                return
            result = subprocess.run(
                [sys.executable, "parse_health.py", "export.xml"],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                self.health_data = load_health_data(local_path=HEALTH_DATA_FILE)
                self.send_json({"ok": True, "output": result.stdout})
            else:
                self.send_json({"ok": False, "error": result.stderr or result.stdout})

        elif self.path == "/api/upload":
            length = int(self.headers.get("Content-Length", 0))
            if length == 0:
                self.send_json({"ok": False, "error": "Empty file"})
                return
            data = self.rfile.read(length)
            with open("export.xml", "wb") as f:
                f.write(data)
            self.send_json({"ok": True, "size": length})

        elif self.path == "/api/chat":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            message = body.get("message", "")
            history = body.get("history", [])
            events = body.get("events", None)
            api_key, mode = resolve_chat_api_key(body)
            model = get_vertex_model()

            if not self.health_data:
                self.send_json({"reply": "No health data loaded. Please run parse_health.py first."})
                return

            health_data = self.health_data
            if events is not None:
                health_data = dict(self.health_data)
                health_data["events"] = events

            if mode == "byok" and not api_key:
                reply = "Add your Vertex AI API key in Settings before using your own key."
            else:
                reply = chat_with_vertex(message, history, health_data, api_key, model)

            self.send_json({"reply": reply, "mode": mode, "model": model})
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


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    """Handle each request in a separate thread so long-running reparsing doesn't block the UI."""
    daemon_threads = True


if __name__ == "__main__":
    port = 8080
    vertex_status = "configured" if os.environ.get("VERTEX_API_KEY") else "NOT SET"
    vertex_model = get_vertex_model()
    print(f"""
Somada Server
=======================
Starting on http://localhost:{port}

API Keys:
  VERTEX_API_KEY : {vertex_status}
  VERTEX_MODEL   : {vertex_model}

Make sure you have run parse_health.py to generate health_data.json
""")
    server = ThreadedHTTPServer(("", port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
