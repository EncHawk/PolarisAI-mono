from __future__ import annotations

import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.auth.google import verify_google_id_token
from app.auth.passwords import hash_password, verify_password
from app.auth.sessions import current_user, generate_api_key
from app.cache import get_cache
from app.config import get_settings
from app.logging_utils import log_step, log_timer, POLARIS_LOGGER
from app.ratelimit import limiter
from app.schemas import AuthOut, GoogleLoginIn, LoginIn, SignupIn, UserOut
from app.store.supabase import get_supabase

router = APIRouter(prefix="/auth", tags=["auth"])


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
    rows = db.table("users").select("id,email,name,username,github,x,credits").eq("email", email).limit(1).execute().data
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
        "credits": 3,
    }
    inserted = db.table("users").insert(new_row).execute().data
    cache[cache_key] = (inserted[0] if inserted else new_row)["id"]
    log_step("auth.oauth.inserted", f"email={email} | id={cache[cache_key]} | {(time.perf_counter()-t0)*1000:.1f}ms")
    return inserted[0] if inserted else new_row


@router.post("/signup", response_model=AuthOut)
@limiter.limit(get_settings().RATELIMIT_AUTH)
async def signup(body: SignupIn, request: Request):
    t0 = time.perf_counter()
    email = body.email.strip().lower()
    log_step("auth.signup.start", f"email={email}")
    if len(body.password) < 8:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "password must be at least 8 characters")
    db = get_supabase()
    existing = db.table("users").select("id").eq("email", email).limit(1).execute().data
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "email already registered")

    api_key = generate_api_key()
    row = {
        "id": str(uuid.uuid4()),
        "name": body.name.strip(),
        "email": email,
        "username": body.name.strip() or email.split("@", 1)[0],
        "github": body.github,
        "password_hash": hash_password(body.password),
        "api_key": api_key,
        "credits": 3,
    }
    inserted = db.table("users").insert(row).execute().data
    user = inserted[0] if inserted else row
    get_cache()[f"user_exists:{email}"] = user["id"]
    log_step("auth.signup.done", f"email={email} | id={user['id']} | {(time.perf_counter()-t0)*1000:.1f}ms")
    return _auth_out(user, api_key)


@router.post("/login", response_model=AuthOut)
@limiter.limit(get_settings().RATELIMIT_AUTH)
async def login(body: LoginIn, request: Request):
    t0 = time.perf_counter()
    email = body.email.strip().lower()
    log_step("auth.login.start", f"email={email}")
    db = get_supabase()
    rows = (
        db.table("users")
        .select("id,email,name,username,github,x,password_hash,credits")
        .eq("email", email)
        .limit(1)
        .execute()
        .data
    )
    if not rows or not verify_password(body.password, rows[0].get("password_hash")):
        POLARIS_LOGGER.warning("auth.login.fail | email=%s | reason=invalid_credentials | %.1fms", email, (time.perf_counter()-t0)*1000)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid email or password")
    user = rows[0]
    api_key = generate_api_key()
    db.table("users").update({"api_key": api_key}).eq("id", user["id"]).execute()
    log_step("auth.login.done", f"email={email} | id={user['id']} | {(time.perf_counter()-t0)*1000:.1f}ms")
    return _auth_out(user, api_key)


@router.post("/google", response_model=AuthOut)
@limiter.limit(get_settings().RATELIMIT_AUTH)
async def google_login(body: GoogleLoginIn, request: Request):
    t0 = time.perf_counter()
    log_step("auth.google.start", f"id_token_len={len(body.id_token)}")
    profile = verify_google_id_token(body.id_token)
    log_step("auth.google.verified", f"email={profile.email} | {(time.perf_counter()-t0)*1000:.1f}ms")
    user = _upsert_oauth_user(profile.email, profile.username, profile.github, profile.x)
    api_key = generate_api_key()
    db = get_supabase()
    db.table("users").update({"api_key": api_key}).eq("id", user["id"]).execute()
    log_step("auth.google.done", f"email={profile.email} | id={user['id']} | {(time.perf_counter()-t0)*1000:.1f}ms")
    return _auth_out(user, api_key)


@router.get("/me", response_model=UserOut)
async def me(user: dict = Depends(current_user)):
    t0 = time.perf_counter()
    log_step("auth.me.start", f"user_id={user['sub']}")
    db = get_supabase()
    rows = db.table("users").select("id,email,name,username,github,x").eq("id", user["sub"]).limit(1).execute().data
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    log_step("auth.me.done", f"user_id={user['sub']} | {(time.perf_counter()-t0)*1000:.1f}ms")
    return UserOut(**rows[0])


@router.post("/logout")
async def logout(user: dict = Depends(current_user)):
    t0 = time.perf_counter()
    log_step("auth.logout.start", f"user_id={user['sub']}")
    db = get_supabase()
    db.table("users").update({"api_key": None}).eq("id", user["sub"]).execute()
    log_step("auth.logout.done", f"user_id={user['sub']} | {(time.perf_counter()-t0)*1000:.1f}ms")
    return {"ok": True}
