"""Write structured traces to redis (live tail) + supabase (durable)

The backend's /events SSE reads the redis list `polaris:traces:{uuid}` for replay
and subscribes to `polaris:traces:{uuid}:pub` for new entries. So we do both:
RPUSH to the list AND PUBLISH the same line. We also persist to supabase `traces`
when available.

We also keep the global job-state in a redis hash `polaris:state:{uuid}` for the
backend's ownership checks and terminal detection.
"""
from __future__ import annotations

from shared.trace import AgentName, TraceEvent, TraceKind

from worker.logger import write_dev_event
from worker.store import get_redis, get_supabase


def emit(job_uuid: str, agent: AgentName, kind: TraceKind, **fields) -> None:
    ev = TraceEvent(job_uuid=job_uuid, agent=agent, kind=kind, **fields)
    line = ev.line()
    write_dev_event("trace", job=job_uuid, agent=agent.value, kind=kind.value,
                    step=ev.step, tool=ev.tool, conclusion=ev.conclusion,
                    output_query=ev.output_query)
    r = get_redis()
    r.rpush(f"polaris:traces:{job_uuid}", line)
    r.publish(f"polaris:traces:{job_uuid}:pub", line)
    db = get_supabase()
    if db is not None:
        try:
            db.table("traces").insert({
                "job_uuid": job_uuid,
                "agent": agent.value,
                "kind": kind.value,
                "step": ev.step,
                "tool": ev.tool,
                "conclusion": ev.conclusion,
                "output_query": ev.output_query,
                "ts": ev.ts,
            }).execute()
        except Exception:
            pass


def step(job_uuid: str, agent: AgentName, step_name: str, *,
         tool: str = "", conclusion: str = "", output_query: str = "") -> None:
    emit(job_uuid, agent, TraceKind.STEP, step=step_name, tool=tool,
         conclusion=conclusion, output_query=output_query)


def output(job_uuid: str, agent: AgentName, conclusion: str,
           output_query: str = "") -> None:
    emit(job_uuid, agent, TraceKind.OUTPUT, conclusion=conclusion,
         output_query=output_query)


def status(job_uuid: str, status_val: str) -> None:
    get_redis().hset(f"polaris:state:{job_uuid}", "status", status_val)
    import json
    emit(job_uuid, AgentName.SYSTEM, TraceKind.STATUS, step="status",
         conclusion=status_val, output_query=json.dumps({"status": status_val}))


def await_user(job_uuid: str, agent: AgentName, conclusion: str, output_query: str) -> None:
    emit(job_uuid, agent, TraceKind.AWAIT_USER, conclusion=conclusion,
         output_query=output_query)


def error(job_uuid: str, agent: AgentName, conclusion: str) -> None:
    emit(job_uuid, agent, TraceKind.ERROR, conclusion=conclusion)
