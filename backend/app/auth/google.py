"""Google ID token verification — used only by POST /auth/exchange.

Google sign-in lives entirely in the frontend (NextJS). The backend verifies
the Google ID token exactly once to mint a Polaris API key, then never touches
Google again.
"""
from __future__ import annotations

from dataclasses import dataclass

from google.auth.transport import requests
from google.oauth2 import id_token

from app.config import get_settings


@dataclass
class GoogleProfile:
    sub: str
    email: str
    name: str | None
    username: str | None
    github: str | None
    x: str | None


def verify_google_id_token(token: str) -> GoogleProfile:
    settings = get_settings()
    info = id_token.verify_oauth2_token(
        token,
        requests.Request(),
        settings.GOOGLE_CLIENT_ID,
    )
    email = info.get("email") or ""
    name = info.get("name")
    # username: prefer the part before @ of a verified email
    username = name or (email.split("@")[0] if email else None)
    return GoogleProfile(
        sub=info["sub"],
        email=email,
        name=name,
        username=username,
        github=None,
        x=None,
    )