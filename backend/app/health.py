"""Health + dependency probes (redis / supabase / github)."""
from __future__ import annotations

import time

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.logging_utils import POLARIS_LOGGER, log_step
from app.store.redis import get_redis
from app.store.supabase import get_supabase

router = APIRouter(tags=["health"])


@router.get("/api/health")
async def health():
    return {"ok": True}


@router.get("/api/ready")
async def ready():
    """Deep readiness check for redis, supabase, and the GitHub org."""
    t0 = time.perf_counter()
    s = get_settings()
    out: dict = {"ok": True, "redis": False, "supabase": False, "github": False, "details": {}}

    try:
        get_redis().ping()
        out["redis"] = True
    except Exception as e:
        out["ok"] = False
        out["details"]["redis"] = str(e)
        POLARIS_LOGGER.error("health.redis.fail | %s", e)

    try:
        db = get_supabase()
        # a cheap select; fails loudly if the key/tables are wrong
        db.table("users").select("id").limit(1).execute()
        out["supabase"] = True
    except Exception as e:
        out["ok"] = False
        out["details"]["supabase"] = str(e)
        POLARIS_LOGGER.error("health.supabase.fail | %s", e)

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
        POLARIS_LOGGER.error("health.github.fail | %s", e)

    out["details"]["github_token_configured"] = bool(s.GITHUB_ACCESS_TOKEN)
    out["details"]["supabase_url"] = s.SUPABASE_URL or "(empty -> in-memory stub)"
    log_step("health.ready", f"ok={out['ok']} | redis={out['redis']} | supabase={out['supabase']} | github={out['github']} | {(time.perf_counter()-t0)*1000:.1f}ms")
    return JSONResponse(status_code=200 if out["ok"] else 503, content=out)
