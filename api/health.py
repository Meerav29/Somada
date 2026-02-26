from http.server import BaseHTTPRequestHandler
import json
import os
import pathlib

ROOT = pathlib.Path(__file__).parent.parent


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        health_file = ROOT / "health_data.json"
        if not health_file.exists():
            data = {"error": "No health data found."}
        else:
            with open(health_file) as f:
                data = json.load(f)
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
