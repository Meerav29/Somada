from http.server import BaseHTTPRequestHandler
import json
import os


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        data = {
            "chat": {
                "serverVertex": bool(os.environ.get("VERTEX_API_KEY")),
                "serverModel": os.environ.get("VERTEX_MODEL", "gemini-2.0-flash"),
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
