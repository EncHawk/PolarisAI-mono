"""Upstash Redis (REST/HTTPS) access.

The app used to talk to a local redis-server via redis-py; it now uses the
connectionless Upstash REST SDK so no redis process needs to run on the host.
`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` come from Settings.

A small `RedisShim` adapts the upstash-redis sync client to the redis-py
method surface the rest of the codebase was written against (notably
`hset(..., mapping=...)` and `blpop(key, timeout=0)`, plus a no-op `pubsub()`
so the SSE `/events` route degrades to durable-list replay rather than 500ing).
"""
from __future__ import annotations

import time

from upstash_redis import Redis as _UpstashRedis

from app.config import get_settings

_redis: RedisShim | None = None


class _PubSubStub:
    """Upstash REST has no SUBSCRIBE; the /events SSE replays the durable
    `polaris:traces:{uuid}` list (still written via rpush) and sits on
    heartbeats. A reconnect picks up everything written meanwhile."""

    def subscribe(self, *channels, **kwargs) -> None:
        return None

    def get_message(self, ignore_subscribe_messages: bool = False, timeout: float = 1.0):
        return None

    def close(self) -> None:
        return None


class RedisShim:
    """redis-py-compatible surface over the Upstash REST SDK."""

    def __init__(self, client: _UpstashRedis) -> None:
        self._c = client

    def set(self, key, value, ex=None, **kw):
        return self._c.set(key, value, ex=ex, **kw)

    def get(self, key):
        return self._c.get(key)

    def delete(self, *keys):
        return self._c.delete(*keys)

    def rpush(self, key, *values):
        return self._c.rpush(key, *values)

    def lpop(self, key, count=None):
        return self._c.lpop(key, count)

    def lrange(self, key, start, stop):
        return self._c.lrange(key, start, stop)

    def llen(self, key):
        return self._c.llen(key)

    def hset(self, key, field=None, value=None, mapping=None):
        if mapping is not None:
            return self._c.hset(key, values=mapping)
        return self._c.hset(key, field=field, value=value)

    def hget(self, key, field):
        return self._c.hget(key, field)

    def hgetall(self, key):
        return self._c.hgetall(key) or {}

    def publish(self, channel, message):
        try:
            return self._c.publish(channel, message)
        except Exception:
            # publish is fire-and-forget; no subscribers is not an error
            return 0

    def blpop(self, key, timeout=0):
        """Upstash REST has no native BLPOP. Poll lpop; timeout=0 means forever."""
        deadline = None if not timeout else time.monotonic() + timeout
        while True:
            v = self._c.lpop(key)
            if v is not None:
                return (key, v)
            if deadline is not None and time.monotonic() >= deadline:
                return None
            time.sleep(1.0)

    def ping(self, message=None):
        return self._c.ping(message) if message else self._c.ping()

    def pubsub(self, *args, **kwargs):
        return _PubSubStub()

    def close(self) -> None:
        try:
            self._c.close()
        except Exception:
            pass


def get_redis() -> RedisShim:
    global _redis
    if _redis is None:
        s = get_settings()
        _redis = RedisShim(
            _UpstashRedis(
                url=s.UPSTASH_REDIS_REST_URL,
                token=s.UPSTASH_REDIS_REST_TOKEN,
            )
        )
    return _redis
