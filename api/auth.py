import api.supabase_http as supabase_http


class AuthError(Exception):
    pass


class AuthContext:
    """Who is calling. Both fields are None in local dev (Supabase not configured)."""

    def __init__(self, user_id=None, token=None):
        self.user_id = user_id
        self.token = token


def extract_bearer_token(headers):
    scheme, _, token = (headers.get("Authorization") or "").strip().partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def verify_token(token):
    """Ask Supabase Auth who owns this token. Returns the user id or raises AuthError."""
    url, anon_key = supabase_http.supabase_env()
    status, body = supabase_http.http_get_json(
        f"{url}/auth/v1/user",
        {"apikey": anon_key, "Authorization": f"Bearer {token}"},
    )
    if status != 200 or not isinstance(body, dict) or not body.get("id"):
        raise AuthError("Invalid or expired session.")
    return body["id"]


def authenticate(headers):
    if not supabase_http.supabase_configured():
        return AuthContext()
    token = extract_bearer_token(headers)
    if not token:
        raise AuthError("Sign in required.")
    return AuthContext(user_id=verify_token(token), token=token)
