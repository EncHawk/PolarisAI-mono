from __future__ import annotations

from typing import Any

from app.config import get_settings
from supabase import Client, create_client

_client: Client | None = None


def get_supabase() -> Client:
    """Lazy singleton supabase client. Falls back to an inert stub when no creds so
    the API still boots for local dev without supabase configured."""
    global _client
    if _client is not None:
        return _client

    s = get_settings()
    if not s.SUPABASE_URL or not s.SUPABASE_KEY:
        _client = _StubClient()  # type: ignore[assignment]
        return _client

    _client = create_client(s.SUPABASE_URL, s.SUPABASE_KEY)
    return _client


class _StubClient:
    """In-memory no-op stand-in. Tables act as dicts so dev without supabase works."""

    def __init__(self) -> None:
        self._tables: dict[str, list[dict[str, Any]]] = {}
        # Pre-populate a test user for local dev
        self._tables["users"] = [{
            "id": "11111111-1111-1111-1111-111111111111",
            "email": "test@example.com",
            "name": "Test User",
            "username": "testuser",
            "github": None,
            "x": None,
            "password_hash": None,
            "credits": 10.0,
            "api_key": "test-api-key-123",
            "subscription_tier": None,
            "renews_at": None,
        }]

    def table(self, name: str) -> _StubTable:
        return _StubTable(self, name)

    def rpc(self, _fn: str, _params: dict | None = None) -> _StubRpc:
        # Dev has no Postgres; return a no-op so billing paths don't crash.
        return _StubRpc()


class _StubQuery:
    def __init__(self, stub: _StubClient, name: str) -> None:
        self._stub = stub
        self._name = name
        self._rows: list[dict[str, Any]] = stub._tables.setdefault(name, [])
        self._filters: dict[str, Any] = {}
        self._order: tuple[str, str] | None = None
        self._limit_n: int | None = None

    def select(self, _cols: str = "*") -> _StubQuery:
        return self

    def eq(self, col: str, val: Any) -> _StubQuery:
        self._filters[col] = val
        return self

    def order(self, col: str, desc: bool = False) -> _StubQuery:
        self._order = (col, "desc" if desc else "asc")
        return self

    def limit(self, n: int) -> _StubQuery:
        self._limit_n = n
        return self

    def insert(self, row: dict[str, Any]) -> _StubQuery:
        self._rows.append(row)
        self._is_insert = True
        return self

    def update(self, patch: dict[str, Any]) -> _StubRowOp:
        return _StubRowOp(self, "update", patch)

    def _result(self) -> list[dict[str, Any]]:
        out = [r for r in self._rows if all(r.get(k) == v for k, v in self._filters.items())]
        if self._order:
            col, d = self._order
            out = sorted(out, key=lambda r: (r.get(col) or ""), reverse=(d == "desc"))
        if self._limit_n is not None:
            out = out[: self._limit_n]
        return out

    def execute(self):
        # INSERT echoes the inserted row back; SELECT returns the filtered rows
        # (possibly empty) -- never a synthetic `{}`.
        if getattr(self, "_is_insert", False):
            rows = self._result()
            inserted = rows[-1] if rows else {}
            class _Resp:
                data = [inserted]
            return _Resp()
        rows = self._result()
        class _Resp:
            data = rows
        return _Resp()


class _StubRowOp:
    def __init__(self, q: _StubQuery, op: str, patch: dict[str, Any]) -> None:
        self._q = q
        self._op = op
        self._patch = patch

    def eq(self, col: str, val: Any) -> _StubRowOp:
        self._q._filters[col] = val
        return self

    def execute(self):
        for r in self._q._result():
            r.update(self._patch)
        class _Resp:
            data = []
        return _Resp()


class _StubRpc:
    def execute(self):
        class _Resp:
            data = None
        return _Resp()


class _StubTable:
    def __init__(self, stub: _StubClient, name: str) -> None:
        self._stub = stub
        self._name = name

    def select(self, _cols: str = "*") -> _StubQuery:
        return _StubQuery(self._stub, self._name).select(_cols)

    def insert(self, row: dict[str, Any]) -> _StubQuery:
        return _StubQuery(self._stub, self._name).insert(row)

    def update(self, patch: dict[str, Any]) -> _StubRowOp:
        return _StubQuery(self._stub, self._name).update(patch)

    def eq(self, col: str, val: Any) -> _StubQuery:
        return _StubQuery(self._stub, self._name).eq(col, val)