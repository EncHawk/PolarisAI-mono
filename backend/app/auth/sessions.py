"""OAuth 2 Bearer-token session management.

- Authenticated requests carry the token in the standard
  `Authorization: Bearer <token>` header (RFC 6750).
- For SSE (EventSource cannot set headers), the token may also be passed
  via the `?api_key=` query param — kept for backward compatibility.
- After login/google/verify flows, the backend also sets an `Authorization`
  httpOnly cookie so browser fetches with `credentials: 'include'` work
  without JS having to touch the token (OAuth 2 BCP — no localStorage).
- The token is a UUID stored on the users table; login regenerates it,
  logout wipes it.
"""
from __future__ import annotations

import uuid

from fastapi import Cookie, Header, HTTPException, Query, status

from app.config import get_settings
from app.store.supabase import get_supabase

API_KEY_HEADER = "X-API-Key"
BEARER_HEADER = "Authorization"
SESSION_COOKIE = "polaris_session"


def generate_api_key() -> str:
    return str(uuid.uuid4())


def _extract_bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer" and parts[1].strip():
        return parts[1].strip()
    return None


def verify_api_key(api_key: str | None) -> dict:
    if not api_key:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing api key")
    db = get_supabase()
    rows = (
        db.table("users")
        .select("id,email,name,username,github,x,credits,api_key")
        .eq("api_key", api_key)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid api key")
    u = rows[0]
    return {
        "sub": u["id"],
        "email": u["email"],
        "name": u.get("name"),
        "username": u.get("username"),
        "github": u.get("github"),
        "x": u.get("x"),
        "credits": u.get("credits") or 0,
    }


def current_user(
    authorization: str | None = Header(default=None, alias=BEARER_HEADER),
    x_api_key: str | None = Header(default=None, alias=API_KEY_HEADER),
    session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> dict:
    token = _extract_bearer(authorization) or x_api_key or session_cookie
    return verify_api_key(token)


async def current_user_optional(
    authorization: str | None = Header(default=None, alias=BEARER_HEADER),
    x_api_key: str | None = Header(default=None, alias=API_KEY_HEADER),
    session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> dict | None:
    token = _extract_bearer(authorization) or x_api_key or session_cookie
    if not token:
        return None
    try:
        return verify_api_key(token)
    except HTTPException:
        return None


def current_user_sse(
    api_key: str | None = Query(default=None, alias="api_key"),
    x_api_key: str | None = Header(default=None, alias=API_KEY_HEADER),
    authorization: str | None = Header(default=None, alias=BEARER_HEADER),
) -> dict:
    token = _extract_bearer(authorization) or x_api_key or api_key
    return verify_api_key(token)


def set_session_cookie(response, api_key: str) -> None:
    """Attach an httpOnly, SameSite=Lax session cookie (OAuth 2 BCP)."""
    response.set_cookie(
        key=SESSION_COOKIE,
        value=api_key,
        httponly=True,
        secure=not get_settings().is_dev,
        samesite="lax",
        max_age=get_settings().SESSION_TTL_SECONDS,
        path="/",
    )


def clear_session_cookie(response) -> None:
    response.delete_cookie(key=SESSION_COOKIE, path="/")


def require_credits(user: dict, cost: int = 1) -> None:
    """Check and deduct credits. Mutates the user dict in place."""
    credits = user.get("credits") or 0
    if credits < cost:
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            f"insufficient credits: need {cost}, have {credits}",
        )
    db = get_supabase()
    new_credits = credits - cost
    db.table("users").update({"credits": new_credits}).eq("id", user["sub"]).execute()
    user["credits"] = new_credits
