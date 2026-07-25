"""Health + dependency probes (redis / supabase / github)."""
from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.store.redis import get_redis
from app.store.supabase import get_supabase

router = APIRouter(tags=["health"])


@router.get("/api/health")
async def health():
    return {"ok": True}


@router.get("/api/ready")
async def ready():
    """Deep readiness check for redis, supabase, and the GitHub org."""
    s = get_settings()
    out: dict = {"ok": True, "redis": False, "supabase": False, "github": False, "details": {}}

    try:
        get_redis().ping()
        out["redis"] = True
    except Exception as e:
        out["ok"] = False
        out["details"]["redis"] = str(e)

    try:
        db = get_supabase()
        # a cheap select; fails loudly if the key/tables are wrong
        db.table("users").select("id").limit(1).execute()
        out["supabase"] = True
    except Exception as e:
        out["ok"] = False
        out["details"]["supabase"] = str(e)

    try:
        from app.github import GitHubClient
        gh = GitHubClient()
        # 404 on a probe repo is fine (org reachable); auth errors are not
        resp = __import__("httpx").get(
            f"{gh.base_url}/orgs/{gh.org}",
            headers=gh.headers,
            timeout=10.0,
        )
        if resp.status_code == 200:
            out["github"] = True
            out["details"]["github_org"] = gh.org
        elif resp.status_code == 404:
            out["ok"] = False
            out["details"]["github"] = (
                f"org '{gh.org}' not found or token lacks access. "
                "Create the org Polaris-Implementations and grant the PAT "
                "repo + read:org (and admin:org if the token should create repos)."
            )
        else:
            out["ok"] = False
            out["details"]["github"] = f"HTTP {resp.status_code}: {resp.text[:200]}"
    except Exception as e:
        out["ok"] = False
        out["details"]["github"] = str(e)

    out["details"]["github_token_configured"] = bool(s.GITHUB_ACCESS_TOKEN)
    out["details"]["supabase_url"] = s.SUPABASE_URL or "(empty -> in-memory stub)"
    return JSONResponse(status_code=200 if out["ok"] else 503, content=out)
