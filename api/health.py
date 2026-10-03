from http.server import BaseHTTPRequestHandler
import json

from api.auth import AuthError, authenticate
from api.chat_core import load_health_data


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            auth = authenticate(self.headers)
        except AuthError as e:
            self._send_json({"error": str(e)}, 401)
            return

        data = load_health_data(auth=auth)
        if data is None:
            data = {"error": "No health data found."}
        self._send_json(data)

    def _send_json(self, data, status=200):
        response = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def log_message(self, format, *args):
        pass
