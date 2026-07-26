"""Code-session API: duplicate-repo choices, payment state, and job start.

Flow
----
1. POST /ingest
   - parses the paper
   - checks Polaris-Implementations/{repo_name} for duplicates
   - if the repo already exists: returns contents + requires_code_choice=true
   - always requires payment before the worker starts
2. POST /code/{job_uuid}/choice   (existing repos only)
   - body: { "action": "modify" | "run" }
3. POST /code/{job_uuid}/pay-dev  (DEV only) OR real payment webhook
4. POST /code/{job_uuid}/start
   - enqueues the pending job onto polaris:jobs
5. Worker CODE agent writes in the Daytona sandbox and git-pushes to the org repo
"""
from __future__ import annotations

import hmac
import json
import time

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from app.redis_keys import redis_keys

from app.auth.sessions import current_user
from app.config import get_settings
from app.logging_utils import log_step, POLARIS_LOGGER
from app.ratelimit import limiter
from app.schemas import CodeChoiceIn, CodeSessionOut, PaymentWebhookIn
from app.store.redis import get_redis
from app.store.supabase import get_supabase

router = APIRouter(prefix="/code", tags=["code"])

_SESSION_COLUMNS = (
    "session_id,user_name,user_email,user_id,repo_name,progress,execution_mode,"
    "payment_status,github_url,repo_exists"
)


def _session(job_uuid: str) -> dict:
    rows = (
        get_supabase().table("code").select(_SESSION_COLUMNS)
        .eq("session_id", job_uuid).limit(1).execute().data
    )
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such code session")
    return rows[0]


def _verify_owner(job_uuid: str, user_id: str) -> dict:
    row = _session(job_uuid)
    if row.get("user_id") != user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your code session")
    return row


def _contents(repo_name: str, exists: bool) -> list[dict]:
    if not exists:
        return []
    from app.github import GitHubClient
    try:
        return GitHubClient().contents(repo_name)
    except Exception as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"failed to read GitHub repo: {e}") from e


def _out(row: dict) -> CodeSessionOut:
    return CodeSessionOut(
        **row,
        repo_contents=_contents(row["repo_name"], bool(row.get("repo_exists"))),
    )


@router.get("/{job_uuid}", response_model=CodeSessionOut)
async def get_code_session(job_uuid: str, user: dict = Depends(current_user)):
    """Return the code session. If the repo already exists, includes its contents."""
    t0 = time.perf_counter()
    log_step("code.get.start", f"job_uuid={job_uuid} | user={user['sub']}")
    out = _out(_verify_owner(job_uuid, user["sub"]))
    log_step("code.get.done", f"job_uuid={job_uuid} | {(time.perf_counter()-t0)*1000:.1f}ms")
    return out


@router.post("/{job_uuid}/choice")
@limiter.limit(get_settings().RATELIMIT_INGEST)
async def choose_existing_repo(
    job_uuid: str,
    body: CodeChoiceIn,
    request: Request,
    user: dict = Depends(current_user),
):
    """Existing-repo path: user picks modify (pay to edit) or run (pay to execute)."""
    t0 = time.perf_counter()
    log_step("code.choice.start", f"job_uuid={job_uuid} | action={body.action} | user={user['sub']}")
    row = _verify_owner(job_uuid, user["sub"])
    if not row.get("repo_exists"):
        raise HTTPException(status.HTTP_409_CONFLICT, "new repositories do not need a choice")

    payment_status = "pending" if get_settings().PAYMENT_CHECKOUT_URL else "unpaid"
    t1 = time.perf_counter()
    get_supabase().table("code").update({
        "execution_mode": body.action,
        "payment_status": payment_status,
    }).eq("session_id", job_uuid).execute()
    log_step("code.choice.db", f"job_uuid={job_uuid} | {(time.perf_counter()-t1)*1000:.1f}ms")

    t1 = time.perf_counter()
    get_redis().hset(f"polaris:state:{job_uuid}", mapping={
        "status": "awaiting_payment",
        "execution_mode": body.action,
        "payment_status": payment_status,
    })
    log_step("code.choice.redis", f"job_uuid={job_uuid} | {(time.perf_counter()-t1)*1000:.1f}ms")
    log_step("code.choice.done", f"job_uuid={job_uuid} | total={(time.perf_counter()-t0)*1000:.1f}ms")
    return {
        "ok": True,
        "action": body.action,
        "payment_required": True,
        "payment_status": payment_status,
        "checkout_url": get_settings().PAYMENT_CHECKOUT_URL or None,
        "message": (
            "Modify the existing repo (you pay for the edit) "
            if body.action == "modify"
            else "Run the existing repo on our sandbox (you pay for the run)"
        ),
    }


@router.post("/{job_uuid}/pay-dev")
@limiter.limit(get_settings().RATELIMIT_INGEST)
async def pay_dev(job_uuid: str, request: Request, user: dict = Depends(current_user)):
    """DEV ONLY: mark the session paid without a real payment provider."""
    t0 = time.perf_counter()
    log_step("code.paydev.start", f"job_uuid={job_uuid} | user={user['sub']}")
    if not get_settings().is_dev:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not available")
    row = _verify_owner(job_uuid, user["sub"])
    mode = row.get("execution_mode") or "create"
    get_supabase().table("code").update({
        "payment_status": "paid",
        "execution_mode": mode,
    }).eq("session_id", job_uuid).execute()
    get_redis().hset(f"polaris:state:{job_uuid}", mapping={
        "payment_status": "paid",
        "execution_mode": mode,
        "status": "paid",
    })
    log_step("code.paydev.done", f"job_uuid={job_uuid} | mode={mode} | {(time.perf_counter()-t0)*1000:.1f}ms")
    return {"ok": True, "payment_status": "paid", "execution_mode": mode}


@router.post("/{job_uuid}/start")
@limiter.limit(get_settings().RATELIMIT_INGEST)
async def start_code_session(
    job_uuid: str,
    request: Request,
    user: dict = Depends(current_user),
):
    """Enqueue the worker job after payment. New repos use execution_mode=create."""
    t0 = time.perf_counter()
    log_step("code.start.start", f"job_uuid={job_uuid} | user={user['sub']}")
    row = _verify_owner(job_uuid, user["sub"])
    if row.get("payment_status") != "paid":
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "payment is required before starting")

    mode = row.get("execution_mode")
    if row.get("repo_exists") and mode not in {"modify", "run"}:
        raise HTTPException(status.HTTP_409_CONFLICT, "choose modify or run before starting")
    if not mode:
        mode = "create"

    redis = get_redis()
    pending_key = redis_keys.PENDING_JOB.format(job_uuid=job_uuid)
    raw = redis.get(pending_key)
    if not raw:
        raise HTTPException(status.HTTP_409_CONFLICT, "code session has already started or expired")
    job = json.loads(raw)
    job["execution_mode"] = mode
    redis.rpush(redis_keys.JOBS, json.dumps(job))
    redis.delete(pending_key)
    redis.hset(f"polaris:state:{job_uuid}", mapping={
        "status": "queued",
        "payment_status": "paid",
        "execution_mode": mode,
    })
    get_supabase().table("code").update({
        "progress": "in-progress",
        "execution_mode": mode,
    }).eq("session_id", job_uuid).execute()
    log_step("code.start.done", f"job_uuid={job_uuid} | mode={mode} | queued | {(time.perf_counter()-t0)*1000:.1f}ms")
    return {"ok": True, "job_uuid": job_uuid, "status": "queued", "execution_mode": mode}


@router.post("/{job_uuid}/payment-webhook")
async def payment_webhook(
    job_uuid: str,
    body: PaymentWebhookIn,
    x_billing_webhook_secret: str | None = Header(default=None),
):
    """Minimal provider-neutral payment hook; the payment provider owns checkout."""
    t0 = time.perf_counter()
    log_step("code.webhook.start", f"job_uuid={job_uuid}")
    secret = get_settings().BILLING_WEBHOOK_SECRET
    if not secret:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "billing webhook is not configured")
    if not x_billing_webhook_secret or not hmac.compare_digest(x_billing_webhook_secret, secret):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid billing webhook")

    _session(job_uuid)
    get_supabase().table("code").update({
        "payment_status": body.status,
    }).eq("session_id", job_uuid).execute()
    get_redis().hset(f"polaris:state:{job_uuid}", "payment_status", body.status)
    log_step("code.webhook.done", f"job_uuid={job_uuid} | status={body.status} | {(time.perf_counter()-t0)*1000:.1f}ms")
    return {"ok": True, "payment_status": body.status}
