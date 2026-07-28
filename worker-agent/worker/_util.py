"""Helpers shared by agent nodes."""
from __future__ import annotations

from typing import TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


def parse_json_or_none(text: str, model: type[T]) -> T | None:
    """Try to extract a JSON object from a model string and validate it."""
    if not text:
        return None
    s = text.strip()
    try:
        return model.model_validate_json(s)
    except Exception:
        pass
    # strip ``` fencing
    fenced = s
    if "```" in s:
        fenced = s.split("```")[1]
        if fenced.startswith("json"):
            fenced = fenced[4:]
    fenced = fenced.strip()
    try:
        return model.model_validate_json(fenced)
    except Exception:
        return None


def is_repeated_output(prev: dict | None, current: dict) -> bool:
    return prev is not None and prev == current


def load_paper_markdown(paper_id: str) -> str:
    """Fetch the parsed markdown from the redis cache the backend stashes at
    `polaris:markdown:{paper_id}` (TTL 1 week)."""
    from worker.store import get_redis
    try:
        cached = get_redis().get(f"polaris:markdown:{paper_id}")
        if cached:
            return cached
    except Exception:
        pass
    return ""


def update_paper_status(paper_id: str, status_val: str, fields: dict | None = None) -> None:
    from worker.store import get_supabase
    db = get_supabase()
    if db is None:
        return
    patch = {"status": status_val, **(fields or {})}
    try:
        db.table("papers").update(patch).eq("id", paper_id).execute()
    except Exception:
        pass


def update_code_session(session_id: str, progress: str, fields: dict | None = None) -> None:
    """Persist worker progress/repo metadata without making Supabase mandatory in dev."""
    from worker.store import get_supabase
    db = get_supabase()
    if db is None:
        return
    patch = {"progress": progress, **(fields or {})}
    try:
        db.table("code").update(patch).eq("session_id", session_id).execute()
    except Exception:
        pass
