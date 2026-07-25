"""SSE stream of worker trace events for a job_uuid.

- Uses the reds list `polaris:traces:{uuid}` as a durable replay log.
- Also subscribes to `polaris:traces:{uuid}:pub` pub/sub for live tailing.
- Streams `data: {json}\n\n` frames with periodic comment heartbeats.
- Closes when the job reaches a terminal state (done/failed).
"""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.auth.sessions import current_user
from app.store.redis import get_redis
from app.store.supabase import get_supabase

router = APIRouter(prefix="/events", tags=["events"])

_TERMINAL = {"done", "failed"}


def _job_state(job_uuid: str) -> dict:
    return get_redis().hgetall(f"polaris:state:{job_uuid}")


def _verify_owner(job_uuid: str, user_id: str) -> None:
    state = _job_state(job_uuid)
    if not state and not _paper_exists_for_user(job_uuid, user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such job")
    if state.get("user_id") and state["user_id"] != user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your job")


def _paper_exists_for_user(job_uuid: str, user_id: str) -> bool:
    db = get_supabase()
    rows = (
        db.table("papers")
        .select("id")
        .eq("job_uuid", job_uuid)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
        .data
    )
    return bool(rows)


@router.get("/{job_uuid}")
async def stream_events(job_uuid: str, request: Request, user: dict = Depends(current_user)):
    _verify_owner(job_uuid, user["sub"])
    redis = get_redis()
    traces_key = f"polaris:traces:{job_uuid}"
    pub_key = f"polaris:traces:{job_uuid}:pub"
    state_key = f"polaris:state:{job_uuid}"

    async def gen():
        # 1) replay existing traces (from the durable list)
        replay = redis.lrange(traces_key, 0, -1)
        for line in replay:
            yield f"data: {line}\n\n"

        # early exit if already terminal
        if redis.hget(state_key, "status") in _TERMINAL:
            yield f"data: {json.dumps({'agent':'SYSTEM','kind':'status','status': redis.hget(state_key, 'status')})}\n\n"
            return

        # 2) live tail via pub/sub + heartbeat
        pubsub = redis.pubsub()
        pubsub.subscribe(pub_key)
        heartbeat_counter = 0
        try:
            while True:
                if await request.is_disconnected():
                    break
                msg = pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if msg and msg.get("type") == "message":
                    data = msg["data"]
                    yield f"data: {data}\n\n"
                    # check terminal
                    try:
                        ev = json.loads(data)
                        status_value = ev.get("status") or ev.get("conclusion")
                        if ev.get("kind") == "status" and status_value in _TERMINAL:
                            return
                    except Exception:
                        pass
                else:
                    heartbeat_counter += 1
                    if heartbeat_counter % 15 == 0:
                        yield ": keep-alive\n\n"
                    await asyncio.sleep(0.1)
        finally:
            pubsub.close()

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
