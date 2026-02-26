from http.server import BaseHTTPRequestHandler
import json
import os


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        data = {
            "providers": {
                "claude": bool(os.environ.get("CLAUDE_API_KEY")),
                "gemini": bool(os.environ.get("GEMINI_API_KEY")),
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
