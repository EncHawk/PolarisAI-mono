"""LangGraph wiring: READ -> (orch) -> RESEARCH -> (orch) -> PLAN -> APPROVE -> CODE -> (orch) -> END."""
from __future__ import annotations

from langgraph.graph import END, StateGraph
from shared.trace import AgentName

from worker.agents.code import run_code
from worker.agents.orchestrator import orchesgate
from worker.agents.plan import run_plan
from worker.agents.read import run_read
from worker.agents.research import run_research
from worker.state import WorkerState
from worker.traces import error, status

# Force-advance an agent after this many orchestrator rejections, so a too-strict
# orchestrator can't loop forever.
MAX_GATE_RETRIES = 2


def _failed(state: WorkerState) -> dict:
    message = state.get("error") or "agent stopped without producing usable output"
    job_uuid = state["job_uuid"]
    error(job_uuid, AgentName.ORCHESTRATOR, message)
    status(job_uuid, "failed")
    return {"status": "failed", "error": message}


def _runs_of(state: WorkerState, agent: str) -> int:
    return (state.get("runs") or {}).get(agent, 0)


def _read(state: WorkerState) -> dict:
    timer = state.get("timer")
    if timer:
        timer.agent_enter("READ")
    try:
        return run_read(state)
    finally:
        if timer:
            timer.agent_exit("READ")


def _gate_read(state: WorkerState) -> str:
    if _runs_of(state, "READ") >= MAX_GATE_RETRIES:
        if not state.get("read"):
            return "failed"
        return "research"
    passed = orchesgate(state, "READ")
    timer = state.get("timer")
    if timer:
        timer.gate("READ", "research" if passed else "read", reason="pass" if passed else "loop")
    return "research" if passed else "read"


def _research(state: WorkerState) -> dict:
    timer = state.get("timer")
    if timer:
        timer.agent_enter("RESEARCH")
    try:
        return run_research(state)
    finally:
        if timer:
            timer.agent_exit("RESEARCH")


def _gate_research(state: WorkerState) -> str:
    if _runs_of(state, "RESEARCH") >= MAX_GATE_RETRIES:
        if not state.get("research"):
            return "failed"
        timer = state.get("timer")
        if timer:
            timer.gate("RESEARCH", "plan", reason="forced-advance (max retries)")
        return "plan"
    passed = orchesgate(state, "RESEARCH")
    timer = state.get("timer")
    if timer:
        timer.gate("RESEARCH", "plan" if passed else "research", reason="pass" if passed else "loop")
    return "plan" if passed else "research"


def _plan(state: WorkerState) -> dict:
    timer = state.get("timer")
    if timer:
        timer.agent_enter("PLAN")
    try:
        return run_plan(state)
    finally:
        if timer:
            timer.agent_exit("PLAN")


def _gate_plan(state: WorkerState) -> str:
    if not state.get("plan"):
        return "failed"
    if state.get("approved"):
        # PLAN is user-gated via the approval block already -> orchestrator advisory, just go.
        timer = state.get("timer")
        if timer:
            timer.gate("PLAN", "code", reason="user-approved")
        return "code"
    # A rejection with feedback gets one bounded re-plan. A bare rejection is
    # terminal instead of incorrectly reporting the job as successfully done.
    if state.get("plan_feedback") and _runs_of(state, "PLAN") < MAX_GATE_RETRIES:
        return "plan"
    return "failed"


def _code(state: WorkerState) -> dict:
    timer = state.get("timer")
    if timer:
        timer.agent_enter("CODE")
    try:
        return run_code(state)
    finally:
        if timer:
            timer.agent_exit("CODE")


def _gate_code(state: WorkerState) -> str:
    if _runs_of(state, "CODE") >= MAX_GATE_RETRIES:
        if not state.get("code"):
            return "failed"
        timer = state.get("timer")
        if timer:
            timer.gate("CODE", "done", reason="forced-advance (max retries)")
        return END
    passed = orchesgate(state, "CODE")
    timer = state.get("timer")
    if timer:
        timer.gate("CODE", "done" if passed else "code", reason="pass" if passed else "loop")
    return END if passed else "code"


def build_graph():
    g = StateGraph(WorkerState)
    g.add_node("read", _read)
    g.add_node("research", _research)
    g.add_node("plan", _plan)
    g.add_node("code", _code)
    g.add_node("failed", _failed)

    g.set_entry_point("read")
    g.add_conditional_edges("read", _gate_read, {"read": "read", "research": "research", "failed": "failed"})
    g.add_conditional_edges("research", _gate_research, {"research": "research", "plan": "plan", "failed": "failed"})
    g.add_conditional_edges("plan", _gate_plan, {"plan": "plan", "code": "code", "failed": "failed"})
    g.add_conditional_edges("code", _gate_code, {"code": "code", END: END, "failed": "failed"})
    g.add_edge("failed", END)

    return g.compile()
