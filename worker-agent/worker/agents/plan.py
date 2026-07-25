"""PLAN agent.

Produces a plan() todo list for the coding agent, AND we then block waiting on
user approval (the user edits / approves via the backend's /plan/{uuid}/approve,
which pushes to `polaris:plan_confirm:{uuid}`). When approved we re-enter CODE.
"""
from __future__ import annotations

import json

from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field
from shared.redis_keys import redis_keys
from shared.trace import AgentName

from worker._util import update_paper_status
from worker.config import get_settings
from worker.models import make_llm
from worker.state import WorkerState, mark_agent_run
from worker.traces import await_user, output, status, step


class PlanResult(BaseModel):
    intends_to_prove: str
    proof_method: str
    researched_usage: str
    deltas_from_base: list[str] = Field(default_factory=list)
    custom_kernels: dict | None = None
    plan: list[str] = Field(default_factory=list)
    ready: bool = False
    output_query: str = ""


SYSTEM = """You are the PLAN agent for an automated paper-reproduction pipeline.
Using the READ + RESEARCH outputs, draft a concrete plan for the CODE agent:

- intends_to_prove : what is the paper trying to show (the claim to reproduce)
- proof_method     : how the paper claims to prove it (experiments / baselines)
- researched_usage : how the previously-researched cited methods are used here
- deltas_from_base : what they changed vs the base method
- custom_kernels   : do they use custom CUDA kernels? if yes -> more details
- plan             : a todolist of files to build (each file does 1 thing), pytorch/raw-python

Be specific and codeable. Output ready=True once the plan is concrete enough to act.
"""


def build_prompt():
    return ChatPromptTemplate.from_messages([
        ("system", SYSTEM),
        ("human", "READ OUTPUT:\n{read}\n\nRESEARCH OUTPUT:\n{research}\n\n"
                  "USER FEEDBACK ON PRIOR PLAN:\n{feedback}\n\nLatest draft:\n{draft}"),
    ])


def run_plan(state: WorkerState) -> dict:
    job_uuid = state["job_uuid"]
    paper_id = state.get("paper_id", "")
    runs = mark_agent_run(state, "PLAN")
    update_paper_status(paper_id, "plan")
    status(job_uuid, "plan")
    s = get_settings()

    llm = make_llm("PLAN", job_uuid)
    structured = llm.with_structured_output(PlanResult)
    prompt = build_prompt()

    draft: PlanResult | None = None
    read_blob = json.dumps(state.get("read") or {}, indent=2)[:15000]
    research_blob = json.dumps(state.get("research") or {}, indent=2)[:15000]

    for i in range(min(s.AGENT_MAX_STEPS, 4)):
        step(job_uuid, AgentName.PLAN, f"plan-iter-{i+1}",
             tool="llm:DeepInfra(OpenAI)",
             conclusion=f"{len(draft.plan) if draft else 0} steps planned",
             output_query=(draft.output_query if draft else "draft plan"))
        try:
            draft = structured.invoke(prompt.format_messages(
                read=read_blob,
                research=research_blob,
                feedback=str(state.get("plan_feedback") or "(none)"),
                draft=(draft.model_dump_json() if draft else "(none)"),
            ))
        except Exception as e:
            step(job_uuid, AgentName.PLAN, f"plan-iter-{i+1}-failed",
                 tool="llm:DeepInfra(OpenAI)", conclusion=f"call failed: {e}")
            break
        output(job_uuid, AgentName.PLAN,
               conclusion=f"iter {i+1}: {len(draft.plan)} plan steps, "
                         f"custom_kernels={'yes' if draft.custom_kernels else 'no'}, "
                         f"ready={draft.ready}",
               output_query=draft.output_query)
        if draft.ready or i == 3:
            break

    if draft is None:
        return {"plan": {}, "runs": runs, "error": "plan produced nothing"}

    plan = {
        "intends_to_prove": draft.intends_to_prove,
        "proof_method": draft.proof_method,
        "researched_usage": draft.researched_usage,
        "deltas_from_base": draft.deltas_from_base,
        "custom_kernels": draft.custom_kernels,
        "plan": draft.plan,
        "ready": draft.ready,
        "output_query": draft.output_query,
    }

    # ---- block on user approval ----
    update_paper_status(paper_id, "awaiting_user_approval")
    status(job_uuid, "awaiting_user_approval")
    await_user(job_uuid, AgentName.PLAN,
               conclusion="plan ready -- awaiting user approval",
               output_query=json.dumps(plan))

    # dedicated blocking connection: no health checks / no socket timeout so an
    # indefinite BLPOP never throws -- the worker just waits for the user.
    timer = state.get("timer")
    if timer:
        timer.approval_wait_start()
    import redis as _redis

    from worker.config import get_settings as _gs
    block_redis = _redis.from_url(
        _gs().REDIS_URL,
        decode_responses=True,
        socket_keepalive=True,
        socket_connect_timeout=10,
        socket_timeout=None,
    )
    key = redis_keys.PLAN_CONFIRM.format(job_uuid=job_uuid)
    payload = block_redis.blpop(key, timeout=0)  # blocks until the user approves/rejects
    block_redis.close()
    if not payload:
        if timer:
            timer.approval_received(False)
        return {"plan": plan, "approved": False}
    _, payload = payload
    try:
        decision = json.loads(payload)
    except Exception:
        decision = {"approved": True, "feedback": ""}
    approved = bool(decision.get("approved"))
    feedback = str(decision.get("feedback", ""))
    if timer:
        timer.approval_received(approved, feedback)

    step(job_uuid, AgentName.PLAN, "user-approval",
         tool="/plan/approve",
         conclusion=("approved" if approved else "rejected") + (f": {feedback}" if feedback else ""),
         output_query="proceed to CODE" if approved else "revise plan")

    # if rejected with feedback, fold it into the plan state so CODE / re-plan can see it
    result = {"plan": plan, "approved": approved, "runs": runs}
    if feedback:
        result["plan_feedback"] = feedback
    return result
