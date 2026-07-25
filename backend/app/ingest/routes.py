from __future__ import annotations

import json
import uuid as _u

from fastapi import APIRouter, Depends, HTTPException, Request, status
from app.redis_keys import redis_keys

from app.auth.sessions import current_user
from app.config import get_settings
from app.github import GitHubClient, GitHubUnavailable
from app.ingest import arxiv
from app.ingest.parser import parse
from app.ratelimit import limiter
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
    try:
        ref = arxiv.resolve(body.arxiv_id, body.arxiv_url, body.pdf_url)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e

    repo_name = _repo_name(ref.arxiv_id)
    try:
        github = GitHubClient()
        existing_repo, repo_contents = github.preview(repo_name)
    except GitHubUnavailable as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e)) from e
    except Exception as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"failed to inspect GitHub repo: {e}") from e

    try:
        markdown = parse(ref)
    except Exception as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"failed to parse pdf: {e}") from e

    if not markdown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "empty parse")

    job_uuid = str(_u.uuid4())
    paper_id = str(_u.uuid4())
    title = arxiv.fetch_title(ref.arxiv_id)

    db = get_supabase()
    github_url = existing_repo.get("html_url") if existing_repo else \
        f"https://github.com/{get_settings().GITHUB_ORG}/{repo_name}"
    db.table("papers").insert({
        "id": paper_id,
        "user_id": user["sub"],
        "arxiv_id": ref.arxiv_id,
        "job_uuid": job_uuid,
        "title": title,
        "markdown": markdown,
        "status": "awaiting_payment",
    }).execute()

    db.table("code").insert({
        "session_id": job_uuid,
        "user_name": user.get("email", "").split("@", 1)[0],
        "user_email": user["email"],
        "user_id": user["sub"],
        "repo_name": repo_name,
        "progress": "in-progress",
        "execution_mode": None if existing_repo else "create",
        "payment_status": "unpaid",
        "github_url": github_url if existing_repo else None,
        "repo_exists": bool(existing_repo),
    }).execute()

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
    redis.hset(f"polaris:state:{job_uuid}", mapping={
        "status": "awaiting_code_choice" if existing_repo else "awaiting_payment",
        "paper_id": paper_id,
        "user_id": user["sub"],
        "repo_name": repo_name,
        "github_url": github_url,
        "repo_exists": str(bool(existing_repo)).lower(),
        "payment_status": "unpaid",
    })

    return IngestOut(
        job_uuid=job_uuid,
        paper_id=paper_id,
        arxiv_id=ref.arxiv_id,
        repo_name=repo_name,
        github_url=github_url,
        repo_exists=bool(existing_repo),
        requires_code_choice=bool(existing_repo),
        payment_required=True,
        payment_status="unpaid",
        checkout_url=get_settings().PAYMENT_CHECKOUT_URL or None,
        repo_contents=repo_contents,
    )
