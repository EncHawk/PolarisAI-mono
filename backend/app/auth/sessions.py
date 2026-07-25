"""Issue + verify our own JWT sessions (HS256)."""
from __future__ import annotations

import jwt
from fastapi import Cookie, Header, HTTPException, status

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


def _resolve_token(
    authorization: str | None = None,
    session: str | None = None,
) -> str | None:
    if authorization and authorization.startswith("Bearer "):
        return authorization[7:]
    return session


def current_user(
    authorization: str | None = Header(default=None),
    session: str | None = Cookie(default=None, alias="polaris_session"),
) -> dict:
    return verify_session_jwt(_resolve_token(authorization, session))


async def current_user_optional(
    authorization: str | None = Header(default=None),
    session: str | None = Cookie(default=None, alias="polaris_session"),
) -> dict | None:
    token = _resolve_token(authorization, session)
    if not token:
        return None
    try:
        return verify_session_jwt(token)
    except HTTPException:
        return None