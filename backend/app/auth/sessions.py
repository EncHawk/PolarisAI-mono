"""API-key based session management.

- Every request carries the key in the X-API-Key header.
- SSE (EventSource) cannot set headers, so it falls back to an ?api_key= query param.
- The key is a UUID stored on the users table. Login regenerates it; logout wipes it.
- The returned user dict maps `id` → `sub` so existing routes keep using user["sub"].
"""
from __future__ import annotations

import uuid

from fastapi import Header, HTTPException, Query, status

from app.store.supabase import get_supabase

API_KEY_HEADER = "X-API-Key"


def generate_api_key() -> str:
    return str(uuid.uuid4())


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
    api_key: str | None = Header(default=None, alias=API_KEY_HEADER),
) -> dict:
    return verify_api_key(api_key)


async def current_user_optional(
    api_key: str | None = Header(default=None, alias=API_KEY_HEADER),
) -> dict | None:
    if not api_key:
        return None
    try:
        return verify_api_key(api_key)
    except HTTPException:
        return None


def current_user_sse(
    api_key: str | None = Query(default=None, alias="api_key"),
    x_api_key: str | None = Header(default=None, alias=API_KEY_HEADER),
) -> dict:
    return verify_api_key(x_api_key or api_key)


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
