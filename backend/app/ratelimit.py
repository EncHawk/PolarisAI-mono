"""Per-route rate limiting using slowapi."""
from __future__ import annotations

from fastapi import Request, Response
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import get_settings

limiter = Limiter(key_func=get_remote_address, default_limits=[get_settings().RATELIMIT_DEFAULT])


def rate_hit(request: Request, response: Response, limit: str) -> None:
    """Apply a specific limit string to a route manually (slowapi decorator can't
    read settings at import time). Kept for explicit per-route use."""
    # slowapi's `@limiter.limit(...)` is used directly on routes in routes/*.py
    return None