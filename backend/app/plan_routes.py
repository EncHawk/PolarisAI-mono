"""Plan approval endpoint.

After the PLAN agent produces a plan, the worker sets status=`awaiting_user_approval`
and BLPOPs `polaris:plan_confirm:{uuid}`, blocking until the user approves (or
rejects with feedback) here.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.auth.sessions import current_user
from app.config import get_settings
from app.ratelimit import limiter
from app.schemas import PlanFeedbackIn
from app.store.redis import get_redis
from app.store.supabase import get_supabase

router = APIRouter(prefix="/plan", tags=["plan"])


def _verify_owner(job_uuid: str, user_id: str) -> None:
    # Prefer the redis job-state hash (populated by /ingest with user_id); it's the
    # hot source of truth and survives even when supabase isn't reachable.
    state = get_redis().hgetall(f"polaris:state:{job_uuid}")
    if state:
        if state.get("user_id") and state["user_id"] != user_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "not your job")
        return
    # fall back to supabase
    db = get_supabase()
    rows = (
        db.table("papers")
        .select("id,user_id")
        .eq("job_uuid", job_uuid)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such job")
    if rows[0].get("user_id") != user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your job")


@router.post("/{job_uuid}/approve")
@limiter.limit(get_settings().RATELIMIT_INGEST)
async def approve_plan(
    job_uuid: str, body: PlanFeedbackIn, request: Request, user: dict = Depends(current_user)
):
    _verify_owner(job_uuid, user["sub"])
    redis = get_redis()
    payload = json.dumps({"approved": body.approved, "feedback": body.feedback})
    redis.rpush(f"polaris:plan_confirm:{job_uuid}", payload)
    return {"ok": True}