from __future__ import annotations

import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.auth.google import verify_google_id_token
from app.auth.sessions import (
    current_user,
    generate_api_key,
)
from app.cache import get_cache
from app.config import get_settings
from app.logging_utils import log_step
from app.ratelimit import limiter
from app.schemas import AccountOut, AuthOut, ExchangeIn
from app.store.supabase import get_supabase

router = APIRouter(prefix="/auth", tags=["auth"])

# First-time OAuth users get a $3.00 starting balance (matches the legacy
# `credits=3` integer default, now in USD).
SIGNUP_BONUS_USD = 3.0000


def _auth_out(user: dict, api_key: str) -> AuthOut:
    return AuthOut(
        user_id=user["id"],
        email=user["email"],
        name=user.get("name"),
        username=user.get("username"),
        github=user.get("github"),
        x=user.get("x"),
        api_key=api_key,
    )


def _upsert_oauth_user(email: str, username: str | None,
                       github: str | None, x: str | None) -> dict:
    """Insert or return the user, caching the existence check by email."""
    t0 = time.perf_counter()
    cache = get_cache()
    db = get_supabase()
    cache_key = f"user_exists:{email}"

    log_step("auth.oauth.lookup", f"email={email}")
    rows = (
        db.table("users")
        .select("id,email,name,username,github,x,credits")
        .eq("email", email)
        .limit(1)
        .execute()
        .data
    )
    if rows:
        cache[cache_key] = rows[0]["id"]
        log_step("auth.oauth.found", f"email={email} | id={rows[0]['id']} | {(time.perf_counter()-t0)*1000:.1f}ms")
        return rows[0]

    log_step("auth.oauth.create", f"email={email}")
    new_row = {
        "id": str(uuid.uuid4()),
        "name": username,
        "email": email,
        "username": username,
        "github": github,
        "x": x,
        "password_hash": None,
        "credits": SIGNUP_BONUS_USD,
    }
    inserted = db.table("users").insert(new_row).execute().data
    cache[cache_key] = (inserted[0] if inserted else new_row)["id"]
    log_step("auth.oauth.inserted", f"email={email} | id={cache[cache_key]} | {(time.perf_counter()-t0)*1000:.1f}ms")
    return inserted[0] if inserted else new_row


@router.post("/exchange", response_model=AuthOut)
@limiter.limit(get_settings().RATELIMIT_AUTH)
async def exchange(body: ExchangeIn, request: Request):
    """One-time Google ID-token -> Polaris API key.

    The frontend handles all Google flows; the backend verifies the ID token
    once, upserts the user, rotates their api_key, and returns it. The NextJS
    layer then stores the api_key in an httpOnly cookie and sends it as
    `Authorization: Bearer …` on every subsequent call. The backend never sees
    Google again after this call.
    """
    t0 = time.perf_counter()
    log_step("auth.exchange.start", f"id_token_len={len(body.id_token)}")
    profile = verify_google_id_token(body.id_token)
    log_step("auth.exchange.verified", f"email={profile.email} | {(time.perf_counter()-t0)*1000:.1f}ms")
    user = _upsert_oauth_user(profile.email, profile.username, profile.github, profile.x)
    api_key = generate_api_key()
    db = get_supabase()
    db.table("users").update({"api_key": api_key}).eq("id", user["id"]).execute()
    log_step("auth.exchange.done", f"email={profile.email} | id={user['id']} | {(time.perf_counter()-t0)*1000:.1f}ms")
    return _auth_out(user, api_key)


@router.get("/account", response_model=AccountOut)
async def account(user: dict = Depends(current_user)):
    """Return the caller's profile + USD balance + subscription state."""
    t0 = time.perf_counter()
    log_step("auth.account.start", f"user_id={user['sub']}")
    db = get_supabase()
    rows = (
        db.table("users")
        .select("id,email,name,username,github,x,credits,subscription_tier,renews_at")
        .eq("id", user["sub"])
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    r = rows[0]
    log_step("auth.account.done", f"user_id={user['sub']} | {(time.perf_counter()-t0)*1000:.1f}ms")
    return AccountOut(
        id=r["id"],
        email=r["email"],
        name=r.get("name"),
        username=r.get("username"),
        github=r.get("github"),
        x=r.get("x"),
        credits=float(r.get("credits") or 0),
        subscription_tier=r.get("subscription_tier"),
        renews_at=r.get("renews_at"),
    )


@router.post("/logout")
async def logout(user: dict = Depends(current_user)):
    """Wipe the caller's api_key row. The NextJS layer also clears its cookie."""
    t0 = time.perf_counter()
    log_step("auth.logout.start", f"user_id={user['sub']}")
    db = get_supabase()
    db.table("users").update({"api_key": None}).eq("id", user["sub"]).execute()
    log_step("auth.logout.done", f"user_id={user['sub']} | {(time.perf_counter()-t0)*1000:.1f}ms")
    return {"ok": True}


__all__ = ["router"]