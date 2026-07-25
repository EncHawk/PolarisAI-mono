from __future__ import annotations

import redis
from redis import Redis

from app.config import get_settings

_redis: Redis | None = None


def get_redis() -> Redis:
    global _redis
    if _redis is None:
        _redis = redis.from_url(
            get_settings().REDIS_URL,
            decode_responses=True,
            socket_keepalive=True,
            socket_connect_timeout=10,
            health_check_interval=30,
        )
    return _redis