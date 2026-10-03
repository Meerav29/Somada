import json
import os
import urllib.error
import urllib.request


def supabase_env():
    """Return (url, anon_key), or (None, None) when Supabase is not configured."""
    url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    anon_key = os.environ.get("SUPABASE_ANON_KEY", "").strip()
    if not url or not anon_key:
        return None, None
    if "your-supabase" in url or "your_supabase" in anon_key.lower():
        return None, None
    return url, anon_key


def supabase_configured():
    return supabase_env()[0] is not None


def http_get_json(url, headers, timeout=3):
    """GET a URL; return (status, parsed_json). Never raises: failures give (code, None) or (0, None)."""
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, None
    except (urllib.error.URLError, TimeoutError, ValueError):
        return 0, None
