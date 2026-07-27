from __future__ import annotations

import json
import time
import uuid as _u

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.auth.sessions import current_user, require_positive_balance
from decimal import Decimal
from app.config import get_settings
from app.github import GitHubClient, GitHubUnavailable
from app.ingest import arxiv
from app.ingest.parser import parse
from app.logging_utils import POLARIS_LOGGER, log_step
from app.ratelimit import limiter
from app.redis_keys import redis_keys
from app.schemas import IngestIn, IngestOut
from app.store.redis import get_redis
from app.store.supabase import get_supabase

router = APIRouter(prefix="/ingest", tags=["ingest"])


def _repo_name(arxiv_id: str) -> str:
    """Stable repo identity: repeated ingests of one arXiv version share a repo."""
    safe_id = "".join(ch if ch.isalnum() else "-" for ch in arxiv_id).strip("-").lower()
    return f"paper-{safe_id}"


@router.post("", response_model=IngestOut)
@limiter.limit(get_settings().RATELIMIT_INGEST)
async def ingest(body: IngestIn, request: Request, user: dict = Depends(current_user)):
    t0 = time.perf_counter()
    log_step("ingest.start", f"user_id={user['sub']} | arxiv={body.arxiv_url or body.arxiv_id or body.pdf_url}")
    require_positive_balance(user)
    has_credits = (user.get("credits") or Decimal(0)) > 0

    t1 = time.perf_counter()
    try:
        ref = arxiv.resolve(body.arxiv_id, body.arxiv_url, body.pdf_url)
    except ValueError as e:
        POLARIS_LOGGER.warning("ingest.resolve.fail | user=%s | error=%s | %.1fms", user["sub"], e, (time.perf_counter()-t1)*1000)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    log_step("ingest.resolve", f"arxiv_id={ref.arxiv_id} | {(time.perf_counter()-t1)*1000:.1f}ms")

    repo_name = _repo_name(ref.arxiv_id)
    t1 = time.perf_counter()
    try:
        github = GitHubClient()
        existing_repo, repo_contents = github.preview(repo_name)
    except GitHubUnavailable as e:
        POLARIS_LOGGER.error("ingest.github.unavailable | repo=%s | error=%s | %.1fms", repo_name, e, (time.perf_counter()-t1)*1000)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e)) from e
    except Exception as e:
        POLARIS_LOGGER.error("ingest.github.error | repo=%s | error=%s | %.1fms", repo_name, e, (time.perf_counter()-t1)*1000)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"failed to inspect GitHub repo: {e}") from e
    log_step("ingest.github", f"repo={repo_name} | exists={bool(existing_repo)} | {(time.perf_counter()-t1)*1000:.1f}ms")

    t1 = time.perf_counter()
    try:
        markdown = parse(ref)
    except Exception as e:
        POLARIS_LOGGER.error("ingest.parse.fail | arxiv_id=%s | error=%s | %.1fms", ref.arxiv_id, e, (time.perf_counter()-t1)*1000)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"failed to parse pdf: {e}") from e
    log_step("ingest.parse", f"arxiv_id={ref.arxiv_id} | chars={len(markdown)} | {(time.perf_counter()-t1)*1000:.1f}ms")

    if not markdown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "empty parse")

    job_uuid = str(_u.uuid4())
    paper_id = str(_u.uuid4())

    t1 = time.perf_counter()
    title = arxiv.fetch_title(ref.arxiv_id)
    log_step("ingest.title", f"arxiv_id={ref.arxiv_id} | title_len={len(title)} | {(time.perf_counter()-t1)*1000:.1f}ms")

    db = get_supabase()
    github_url = existing_repo.get("html_url") if existing_repo else \
        f"https://github.com/{get_settings().GITHUB_ORG}/{repo_name}"

    t1 = time.perf_counter()
    db.table("papers").insert({
        "id": paper_id,
        "user_id": user["sub"],
        "arxiv_id": ref.arxiv_id,
        "job_uuid": job_uuid,
        "title": title,
        "status": "queued" if has_credits else "awaiting_payment",
    }).execute()
    log_step("ingest.db.papers", f"paper_id={paper_id} | {(time.perf_counter()-t1)*1000:.1f}ms")

    t1 = time.perf_counter()
    db.table("code").insert({
        "session_id": job_uuid,
        "user_name": user.get("email", "").split("@", 1)[0],
        "user_email": user["email"],
        "user_id": user["sub"],
        "repo_name": repo_name,
        "progress": "in-progress",
        "execution_mode": None if existing_repo else "create",
        "payment_status": "paid" if has_credits else "unpaid",
        "github_url": github_url if existing_repo else None,
        "repo_exists": bool(existing_repo),
    }).execute()
    log_step("ingest.db.code", f"job_uuid={job_uuid} | {(time.perf_counter()-t1)*1000:.1f}ms")

    redis = get_redis()
    job = {
        "job_uuid": job_uuid,
        "paper_id": paper_id,
        "user_id": user["sub"],
        "arxiv_id": ref.arxiv_id,
        "top_n_citations": get_settings().INGEST_TOP_N_CITATIONS,
        "repo_name": repo_name,
        "github_url": github_url,
        "repo_exists": bool(existing_repo),
        "execution_mode": None if existing_repo else "create",
    }
    # cache the parsed markdown in redis so the worker (separate process) can read it
    # without needing its own supabase roundtrip; TTL of a week.
    redis.set(f"polaris:markdown:{paper_id}", markdown, ex=604800)
    redis.set(redis_keys.PENDING_JOB.format(job_uuid=job_uuid), json.dumps(job), ex=604800)
    initial_status = "queued" if has_credits else ("awaiting_code_choice" if existing_repo else "awaiting_payment")
    redis.hset(f"polaris:state:{job_uuid}", mapping={
        "status": initial_status,
        "paper_id": paper_id,
        "user_id": user["sub"],
        "repo_name": repo_name,
        "github_url": github_url,
        "repo_exists": str(bool(existing_repo)).lower(),
        "payment_status": "paid" if has_credits else "unpaid",
    })
    if has_credits:
        redis.rpush(redis_keys.JOBS, json.dumps(job))
        redis.delete(redis_keys.PENDING_JOB.format(job_uuid=job_uuid))
        db.table("code").update({"progress": "in-progress"}).eq("session_id", job_uuid).execute()
    log_step("ingest.redis", f"job_uuid={job_uuid} | {(time.perf_counter()-t1)*1000:.1f}ms")

    total = (time.perf_counter() - t0) * 1000
    log_step("ingest.done", f"job_uuid={job_uuid} | total={total:.1f}ms")
    return IngestOut(
        job_uuid=job_uuid,
        paper_id=paper_id,
        arxiv_id=ref.arxiv_id,
        repo_name=repo_name,
        github_url=github_url,
        repo_exists=bool(existing_repo),
        requires_code_choice=bool(existing_repo) and not has_credits,
        payment_required=not has_credits,
        payment_status="paid" if has_credits else "unpaid",
        checkout_url=None if has_credits else (get_settings().PAYMENT_CHECKOUT_URL or None),
        repo_contents=repo_contents,
    )
