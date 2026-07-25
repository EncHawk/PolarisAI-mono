"""Issue + verify our own JWT sessions (HS256). Returned over httpOnly cookie + JSON."""
from __future__ import annotations

import jwt
from fastapi import Cookie, HTTPException, status

from app.config import get_settings


def issue_session_jwt(user_id: str, email: str) -> str:
    s = get_settings()
    payload = {"sub": user_id, "email": email}
    return jwt.encode(payload, s.JWT_SECRET, algorithm=s.JWT_ALG)


def verify_session_jwt(token: str | None) -> dict:
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing session")
    s = get_settings()
    try:
        return jwt.decode(token, s.JWT_SECRET, algorithms=[s.JWT_ALG])
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid session") from e


def current_user(session: str | None = Cookie(default=None, alias="polaris_session")) -> dict:
    return verify_session_jwt(session)


async def current_user_optional(
    session: str | None = Cookie(default=None, alias="polaris_session"),
) -> dict | None:
    if not session:
        return None
    try:
        return verify_session_jwt(session)
    except HTTPException:
        return None