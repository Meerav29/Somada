from http.server import BaseHTTPRequestHandler
import json
import os

from api.chat_core import chat_with_vertex, get_vertex_model, load_health_data


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

        message = body.get("message", "")
        history = body.get("history", [])
        events = body.get("events", None)
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
