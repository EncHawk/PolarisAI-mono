"""In-memory TTL LRU cache for "does this user already exist" type lookups.

Used by the auth flow to keep the supabase roundtrip out of the hot path (the
SPEC's "TTS" cache -- a TTL cache)."""
from __future__ import annotations

from cachetools import TTLCache

_cache: TTLCache | None = None


def get_cache() -> TTLCache:
    global _cache
    if _cache is None:
        _cache = TTLCache(maxsize=4096, ttl=300)  # 5 min TTL
    return _cache