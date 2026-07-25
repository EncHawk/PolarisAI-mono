from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.auth.google import verify_google_id_token
from app.auth.passwords import hash_password, verify_password
from app.auth.sessions import current_user, issue_session_jwt
from app.cache import get_cache
from app.config import get_settings
from app.ratelimit import limiter
from app.schemas import AuthOut, GoogleLoginIn, LoginIn, SignupIn, UserOut
from app.store.supabase import get_supabase

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_session(response: Response, user_id: str, email: str, is_https: bool = False) -> None:
    token = issue_session_jwt(user_id, email)
    s = get_settings()
    response.set_cookie(
        key="polaris_session",
        value=token,
        samesite="none" if is_https else "lax",
        max_age=s.SESSION_TTL_SECONDS,
        secure=is_https,
        path="/",
    )


def _auth_out(user: dict) -> AuthOut:
    return AuthOut(
        user_id=user["id"],
        email=user["email"],
        username=user.get("username"),
        name=user.get("name"),
        github=user.get("github"),
        x=user.get("x"),
    )


def _upsert_oauth_user(email: str, username: str | None,
                       github: str | None, x: str | None) -> dict:
    """Insert or return the user, caching the existence check by email."""
    cache = get_cache()
    db = get_supabase()
    cache_key = f"user_exists:{email}"

    rows = db.table("users").select("id,email,name,username,github,x").eq("email", email).limit(1).execute().data
    if rows:
        cache[cache_key] = rows[0]["id"]
        return rows[0]

    new_row = {
        "id": str(uuid.uuid4()),
        "name": username,
        "email": email,
        "username": username,
        "github": github,
        "x": x,
        "password_hash": None,
    }
    inserted = db.table("users").insert(new_row).execute().data
    cache[cache_key] = (inserted[0] if inserted else new_row)["id"]
    return inserted[0] if inserted else new_row


@router.post("/signup", response_model=AuthOut)
@limiter.limit(get_settings().RATELIMIT_AUTH)
async def signup(body: SignupIn, response: Response, request: Request):
    email = body.email.strip().lower()
    if len(body.password) < 8:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "password must be at least 8 characters")
    db = get_supabase()
    existing = db.table("users").select("id").eq("email", email).limit(1).execute().data
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "email already registered")

    row = {
        "id": str(uuid.uuid4()),
        "name": body.name.strip(),
        "email": email,
        "username": body.name.strip() or email.split("@", 1)[0],
        "github": body.github,
        "password_hash": hash_password(body.password),
    }
    inserted = db.table("users").insert(row).execute().data
    user = inserted[0] if inserted else row
    get_cache()[f"user_exists:{email}"] = user["id"]
    _set_session(response, user["id"], user["email"], request.url.scheme == "https")
    return _auth_out(user)


@router.post("/login", response_model=AuthOut)
@limiter.limit(get_settings().RATELIMIT_AUTH)
async def login(body: LoginIn, response: Response, request: Request):
    email = body.email.strip().lower()
    db = get_supabase()
    rows = (
        db.table("users")
        .select("id,email,name,username,github,x,password_hash")
        .eq("email", email)
        .limit(1)
        .execute()
        .data
    )
    if not rows or not verify_password(body.password, rows[0].get("password_hash")):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid email or password")
    user = rows[0]
    _set_session(response, user["id"], user["email"], request.url.scheme == "https")
    return _auth_out(user)


@router.post("/google", response_model=AuthOut)
@limiter.limit(get_settings().RATELIMIT_AUTH)
async def google_login(body: GoogleLoginIn, response: Response, request: Request):
    profile = verify_google_id_token(body.id_token)
    user = _upsert_oauth_user(profile.email, profile.username, profile.github, profile.x)
    _set_session(response, user["id"], user["email"], request.url.scheme == "https")
    return _auth_out(user)


@router.get("/me", response_model=UserOut)
async def me(user: dict = Depends(current_user)):
    db = get_supabase()
    rows = db.table("users").select("id,email,name,username,github,x").eq("id", user["sub"]).limit(1).execute().data
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    return UserOut(**rows[0])


@router.post("/logout")
async def logout(request: Request, response: Response):
    is_https = request.url.scheme == "https"
    response.set_cookie(
        key="polaris_session",
        value="",
        max_age=0,
        path="/",
        secure=is_https,
        samesite="none" if is_https else "lax",
    )
    return {"ok": True}