from http.server import BaseHTTPRequestHandler
import json
import os


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        configured_model = (os.environ.get("VERTEX_MODEL") or "").strip()
        retired_model_upgrades = {
            "gemini-2.0-flash": "gemini-2.5-flash",
            "gemini-2.0-flash-001": "gemini-2.5-flash",
            "gemini-2.0-flash-lite": "gemini-2.5-flash-lite",
            "gemini-2.0-flash-lite-001": "gemini-2.5-flash-lite",
        }
        data = {
            "chat": {
                "serverVertex": bool(os.environ.get("VERTEX_API_KEY")),
                "serverModel": retired_model_upgrades.get(configured_model, configured_model or "gemini-2.5-flash"),
                "serverClaude": bool(os.environ.get("ANTHROPIC_API_KEY")),
                "claudeModel": (os.environ.get("CLAUDE_MODEL") or "").strip() or "claude-sonnet-4-6",
                "byokSupported": True,
            }
        }
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
