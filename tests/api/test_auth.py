import pytest

from api.auth import AuthError, authenticate, extract_bearer_token, verify_token
from api.supabase_http import supabase_configured, supabase_env


def test_extract_bearer_token_valid():
    assert extract_bearer_token({"Authorization": "Bearer abc.def"}) == "abc.def"


@pytest.mark.parametrize("value", [None, "", "Bearer", "Bearer   ", "Basic abc", "abc"])
def test_extract_bearer_token_rejects_malformed(value):
    headers = {} if value is None else {"Authorization": value}
    assert extract_bearer_token(headers) is None


def test_supabase_env_unset(no_supabase):
    assert supabase_env() == (None, None)
    assert supabase_configured() is False


def test_supabase_env_placeholder_is_unconfigured(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://your-supabase.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "your_supabase_anon_key")
    assert supabase_configured() is False


def test_supabase_env_strips_trailing_slash(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co/")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "k")
    assert supabase_env() == ("https://example.supabase.co", "k")


def test_verify_token_returns_user_id(fake_supabase):
    assert verify_token("token-a") == "user-a"


def test_verify_token_rejects_unknown_token(fake_supabase):
    with pytest.raises(AuthError):
        verify_token("nope")


def test_authenticate_local_dev_needs_no_token(no_supabase):
    ctx = authenticate({})
    assert ctx.user_id is None and ctx.token is None


def test_authenticate_requires_token_when_configured(fake_supabase):
    with pytest.raises(AuthError):
        authenticate({})


def test_authenticate_returns_verified_context(fake_supabase):
    ctx = authenticate({"Authorization": "Bearer token-b"})
    assert ctx.user_id == "user-b" and ctx.token == "token-b"


def test_authenticate_rejects_bad_token(fake_supabase):
    with pytest.raises(AuthError):
        authenticate({"Authorization": "Bearer nope"})


def test_verify_token_rejects_non_dict_body(fake_supabase, monkeypatch):
    """Test that verify_token handles non-dict JSON responses (e.g., list)."""
    monkeypatch.setattr(
        "api.supabase_http.http_get_json",
        lambda url, headers, timeout=3: (200, [1])
    )
    with pytest.raises(AuthError):
        verify_token("token-a")


def test_verify_token_rejects_missing_id(fake_supabase, monkeypatch):
    """Test that verify_token rejects dict response without id field."""
    monkeypatch.setattr(
        "api.supabase_http.http_get_json",
        lambda url, headers, timeout=3: (200, {})
    )
    with pytest.raises(AuthError):
        verify_token("token-a")


def test_verify_token_rejects_network_error(fake_supabase, monkeypatch):
    """Test that verify_token rejects network error responses."""
    monkeypatch.setattr(
        "api.supabase_http.http_get_json",
        lambda url, headers, timeout=3: (0, None)
    )
    with pytest.raises(AuthError):
        verify_token("token-a")
