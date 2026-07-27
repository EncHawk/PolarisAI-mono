"""Internal endpoint the worker calls to record LLM token usage.

Guarded by WORKER_SECRET (shared with the worker). Each call:
  1. Appends a row to usage_events (append-only audit ledger).
  2. Atomically deducts cost_usd from users.credits (RPC; never goes negative).
Cost = (input + output tokens) / 100_000 * $0.05.
"""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from app.auth.sessions import current_user, record_usage
from app.config import get_settings
from app.logging_utils import log_step
from app.ratelimit import limiter
from app.schemas import UsageReportIn

router = APIRouter(prefix="/internal", tags=["internal"])


def _verify_worker(x_worker_secret: str | None = Header(default=None, alias="X-Worker-Secret")) -> None:
    settings = get_settings()
    expected = settings.WORKER_SECRET
    presented = bool(x_worker_secret)
    if not expected:
        log_step("usage.worker_secret.unset", "backend WORKER_SECRET is not configured")
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "worker secret not configured")
    if not presented or x_worker_secret != expected:
        log_step("usage.worker_secret.rejected", f"presented={presented}")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid worker secret")
    log_step("usage.worker_secret.ok", "worker authenticated")


@router.post("/usage")
@limiter.limit(get_settings().RATELIMIT_DEFAULT)
async def report_usage(
    body: UsageReportIn,
    request: Request,
    _w: None = Depends(_verify_worker),
):
    t0 = time.perf_counter()
    log_step(
        "usage.report.start",
        f"user={body.user_id} | job={body.job_uuid} | agent={body.agent} | "
        f"model={body.model} | in={body.input_tokens} out={body.output_tokens}",
    )
    cost = record_usage(
        user_id=body.user_id,
        job_uuid=body.job_uuid,
        agent=body.agent,
        model=body.model,
        input_tokens=body.input_tokens,
        output_tokens=body.output_tokens,
    )
    log_step(
        "usage.report.done",
        f"user={body.user_id} | job={body.job_uuid} | agent={body.agent} | "
        f"in={body.input_tokens} out={body.output_tokens} cost={cost} | "
        f"{(time.perf_counter()-t0)*1000:.1f}ms",
    )
    return {"ok": True, "cost_usd": float(cost)}


# Account view: the caller's own token usage for a job (optional, for the UI).
@router.get("/usage/{job_uuid}")
async def job_usage(job_uuid: str, user: dict = Depends(current_user)):
    from app.store.supabase import get_supabase

    t0 = time.perf_counter()
    log_step("usage.job.list.start", f"job={job_uuid} | user={user['sub']}")
    rows = (
        get_supabase()
        .table("usage_events")
        .select("agent,model,input_tokens,output_tokens,cost_usd,ts")
        .eq("job_uuid", job_uuid)
        .eq("user_id", user["sub"])
        .order("ts", desc=True)
        .limit(500)
        .execute()
        .data
    )
    total_cost = sum(float(r.get("cost_usd") or 0) for r in rows)
    log_step("usage.job.list.done", f"job={job_uuid} | rows={len(rows)} | total_cost={total_cost:.6f} | {(time.perf_counter()-t0)*1000:.1f}ms")
    return {"items": rows or []}