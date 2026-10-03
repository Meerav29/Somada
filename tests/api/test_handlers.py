import api.chat as chat_module
import api.health as health_module


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_health_requires_token(fake_supabase, call):
    status, body = call(health_module.handler)
    assert status == 401 and "error" in body


def test_health_rejects_bad_token(fake_supabase, call):
    status, _ = call(health_module.handler, headers=bearer("nope"))
    assert status == 401


def test_health_returns_only_callers_data(fake_supabase, call):
    status, body = call(health_module.handler, headers=bearer("token-a"))
    assert status == 200 and body == {"who": "a"}


def test_health_new_user_gets_demo(fake_supabase, call):
    fake_supabase["users"]["token-c"] = "user-c"
    status, body = call(health_module.handler, headers=bearer("token-c"))
    assert status == 200 and body == {"who": "demo", "is_demo": True}


def test_health_local_dev_needs_no_token(no_supabase, call, monkeypatch):
    monkeypatch.setattr(health_module, "load_health_data", lambda auth=None: {"who": "local"})
    status, body = call(health_module.handler)
    assert status == 200 and body == {"who": "local"}


def test_health_no_data_message_preserved(fake_supabase, call):
    fake_supabase["users"]["token-c"] = "user-c"
    fake_supabase["demo"] = None
    status, body = call(health_module.handler, headers=bearer("token-c"))
    assert status == 200 and body == {"error": "No health data found."}


def test_chat_requires_token_and_never_calls_the_model(fake_supabase, call, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "server-key")
    calls = []
    monkeypatch.setattr(chat_module, "chat_with_claude", lambda *a, **k: calls.append(a) or "x")
    status, body = call(
        chat_module.handler, "POST", body={"message": "hi", "chatMode": "claude"}
    )
    assert status == 401 and "error" in body
    assert calls == []


def test_chat_uses_the_callers_own_data(fake_supabase, call, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "server-key")
    seen = {}

    def fake_claude(message, history, health_data, api_key, model):
        seen["health_data"] = health_data
        return "stub reply"

    monkeypatch.setattr(chat_module, "chat_with_claude", fake_claude)
    status, body = call(
        chat_module.handler,
        "POST",
        headers=bearer("token-b"),
        body={"message": "hi", "chatMode": "claude"},
    )
    assert status == 200 and body["reply"] == "stub reply"
    assert seen["health_data"] == {"who": "b"}
