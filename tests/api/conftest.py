import json
import threading
import urllib.error
import urllib.request
from http.server import HTTPServer

import pytest


@pytest.fixture
def fake_supabase(monkeypatch):
    """Configure Supabase env and replace http_get_json with an RLS-emulating fake."""
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    state = {
        "users": {"token-a": "user-a", "token-b": "user-b"},
        "rows": {"user-a": {"who": "a"}, "user-b": {"who": "b"}},
        "demo": {"who": "demo"},
        "calls": [],
        "force_status": {},  # url substring -> (status, body) to simulate failures
    }

    def fake_get(url, headers, timeout=3):
        state["calls"].append((url, dict(headers)))
        token = headers.get("Authorization", "").removeprefix("Bearer ")
        uid = state["users"].get(token)
        for needle, forced in state["force_status"].items():
            if needle in url:
                return forced
        if "/auth/v1/user" in url:
            return (200, {"id": uid}) if uid else (401, None)
        if not uid:  # anon / bad token sees nothing under RLS
            return 200, []
        if "user_id=eq." in url:
            requested = url.split("user_id=eq.")[1].split("&")[0]
            row = state["rows"].get(requested) if requested == uid else None
            return 200, ([{"data": row}] if row else [])
        if "is_demo=eq.true" in url:
            return 200, ([{"data": state["demo"]}] if state["demo"] else [])
        return 200, []

    monkeypatch.setattr("api.supabase_http.http_get_json", fake_get)
    return state


@pytest.fixture
def no_supabase(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)


@pytest.fixture
def call():
    """call(handler_cls, method='GET', headers=None, body=None) -> (status, json)."""
    servers = []

    def _call(handler_cls, method="GET", headers=None, body=None):
        server = HTTPServer(("127.0.0.1", 0), handler_cls)
        servers.append(server)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}/",
            data=data,
            method=method,
            headers={"Content-Type": "application/json", **(headers or {})},
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    yield _call
    for s in servers:
        s.shutdown()
        s.server_close()
