from http.server import BaseHTTPRequestHandler
import json

from api.chat_core import load_health_data


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        data = load_health_data()
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
