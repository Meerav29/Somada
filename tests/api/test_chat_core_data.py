import json

import pytest

from api.auth import AuthContext
from api.chat_core import fetch_supabase_health_data, load_health_data


def test_user_gets_their_own_row(fake_supabase):
    ctx = AuthContext(user_id="user-a", token="token-a")
    assert fetch_supabase_health_data(ctx) == {"who": "a"}


def test_user_without_row_gets_demo(fake_supabase):
    fake_supabase["users"]["token-c"] = "user-c"
    ctx = AuthContext(user_id="user-c", token="token-c")
    assert fetch_supabase_health_data(ctx) == {"who": "demo", "is_demo": True}


def test_no_row_and_no_demo_returns_none(fake_supabase):
    fake_supabase["users"]["token-c"] = "user-c"
    fake_supabase["demo"] = None
    ctx = AuthContext(user_id="user-c", token="token-c")
    assert fetch_supabase_health_data(ctx) is None


def test_queries_use_the_callers_jwt_not_the_anon_key(fake_supabase):
    fetch_supabase_health_data(AuthContext(user_id="user-a", token="token-a"))
    for url, headers in fake_supabase["calls"]:
        assert headers["Authorization"] == "Bearer token-a"
        assert headers["apikey"] == "anon-key"
        assert "limit=1" not in url


def test_never_requests_another_users_row(fake_supabase):
    fetch_supabase_health_data(AuthContext(user_id="user-a", token="token-a"))
    assert all("user-b" not in url for url, _ in fake_supabase["calls"])


def test_configured_without_auth_returns_none_and_skips_local_file(fake_supabase, tmp_path):
    local = tmp_path / "health_data.json"
    local.write_text(json.dumps({"who": "local"}))
    assert load_health_data(local_path=local) is None
    assert fake_supabase["calls"] == []


def test_configured_does_not_fall_back_to_local_file(fake_supabase, tmp_path):
    fake_supabase["users"]["token-c"] = "user-c"
    fake_supabase["demo"] = None
    local = tmp_path / "health_data.json"
    local.write_text(json.dumps({"who": "local"}))
    ctx = AuthContext(user_id="user-c", token="token-c")
    assert load_health_data(local_path=local, auth=ctx) is None


def test_local_dev_reads_local_file(no_supabase, tmp_path):
    local = tmp_path / "health_data.json"
    local.write_text(json.dumps({"who": "local"}))
    assert load_health_data(local_path=local) == {"who": "local"}


def test_local_dev_missing_file_returns_none(no_supabase, tmp_path):
    assert load_health_data(local_path=tmp_path / "missing.json") is None


def test_own_row_has_no_is_demo_key(fake_supabase):
    ctx = AuthContext(user_id="user-a", token="token-a")
    assert "is_demo" not in fetch_supabase_health_data(ctx)


@pytest.mark.parametrize("forced", [(503, None), (0, None), (500, None), (401, None)])
def test_failed_own_row_query_does_not_serve_demo(fake_supabase, forced):
    fake_supabase["force_status"]["user_id=eq.user-a"] = forced
    ctx = AuthContext(user_id="user-a", token="token-a")
    assert fetch_supabase_health_data(ctx) is None
    assert all("is_demo" not in url for url, _ in fake_supabase["calls"])


def test_failed_demo_query_returns_none(fake_supabase):
    fake_supabase["users"]["token-c"] = "user-c"
    fake_supabase["force_status"]["is_demo=eq.true"] = (503, None)
    ctx = AuthContext(user_id="user-c", token="token-c")
    assert fetch_supabase_health_data(ctx) is None


def test_own_row_request_url_shape(fake_supabase):
    fetch_supabase_health_data(AuthContext(user_id="user-a", token="token-a"))
    assert [url for url, _ in fake_supabase["calls"]] == [
        "https://example.supabase.co/rest/v1/health_data?select=data&user_id=eq.user-a"
    ]


def test_demo_fallback_request_url_shape(fake_supabase):
    fake_supabase["users"]["token-c"] = "user-c"
    fetch_supabase_health_data(AuthContext(user_id="user-c", token="token-c"))
    assert [url for url, _ in fake_supabase["calls"]] == [
        "https://example.supabase.co/rest/v1/health_data?select=data&user_id=eq.user-c",
        "https://example.supabase.co/rest/v1/health_data?select=data&is_demo=eq.true",
    ]
