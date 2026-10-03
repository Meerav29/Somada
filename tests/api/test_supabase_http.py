import http.client
import urllib.error

import pytest

from api.supabase_http import http_get_json


def test_http_get_json_handles_connection_reset(monkeypatch):
    """Test that http_get_json returns (0, None) on ConnectionResetError."""
    def mock_urlopen(req, timeout=3):
        raise ConnectionResetError("Connection reset by peer")

    monkeypatch.setattr("urllib.request.urlopen", mock_urlopen)
    status, body = http_get_json("http://example.com", {})
    assert status == 0 and body is None


def test_http_get_json_handles_remote_disconnected(monkeypatch):
    """Test that http_get_json returns (0, None) on http.client.RemoteDisconnected."""
    def mock_urlopen(req, timeout=3):
        raise http.client.RemoteDisconnected("Remote end closed connection")

    monkeypatch.setattr("urllib.request.urlopen", mock_urlopen)
    status, body = http_get_json("http://example.com", {})
    assert status == 0 and body is None


def test_http_get_json_handles_http_error(monkeypatch):
    """Test that http_get_json returns (code, None) on HTTPError."""
    def mock_urlopen(req, timeout=3):
        raise urllib.error.HTTPError("http://example.com", 401, "Unauthorized", {}, None)

    monkeypatch.setattr("urllib.request.urlopen", mock_urlopen)
    status, body = http_get_json("http://example.com", {})
    assert status == 401 and body is None
