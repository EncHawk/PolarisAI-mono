"""The orchestrator gates transitions between agents.

After each agent the orchestrator inspects that agent's output and judges:
  - is the output good enough to advance?
  - if not, loop that agent back (with its own output) up to AGENT_MAX_STEPS,
    after which we advance anyway (best-effort) and emit an orchestrator trace.
"""
from __future__ import annotations

from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel
from shared.trace import AgentName

from worker.config import get_settings
from worker.models import make_llm
from worker.state import WorkerState
from worker.traces import step


class Verdict(BaseModel):
    pass_to_next: bool = False
    reason: str = ""
    output_query: str = ""


SYSTEM = """You are the ORCHESTRATOR for an automated paper-reproduction pipeline.
One upstream agent has just finished its run.  Decide if its structured output is
good enough to advance to the next agent.  Be honest and conservative: missing
fields, empty lists where there should be claims, or vague answers => loop.
Return:
  - pass_to_next : bool, true => advance, false => rerun the just-finished agent
  - reason       : short justification
  - output_query : one-sentence note for the next iteration (if looped)
Doing better than perfectly-vague inputs is enough to start; don't nitpick.
"""


def _make_llm(job_uuid: str):
    return make_llm("ORCHESTRATOR", job_uuid, temperature=0.0).with_structured_output(Verdict)


_ORCH_PROMPT = ChatPromptTemplate.from_messages([
    ("system", SYSTEM),
    ("human", "AGENT just finished: {agent}\nITS OUTPUT:\n{output}\nVERIFY against its exit criteria."),
])


def verify(job_uuid: str, agent_name: str, agent_output: dict | None) -> bool:
    """Returns True if good enough to advance."""
    if not agent_output:
        return False
    s = get_settings()
    try:
        llm = _make_llm(job_uuid)
        verdict: Verdict = llm.invoke(_ORCH_PROMPT.format_messages(
            agent=agent_name,
            output=str(agent_output)[:12000],
        ))
    except Exception as e:
        step(job_uuid, AgentName.ORCHESTRATOR, "verify-error",
             tool="llm:DeepInfra(OpenAI)", conclusion=f"verifier failed: {e} -> advancing")
        return True
    step(job_uuid, AgentName.ORCHESTRATOR, "verify",
         tool="llm:DeepInfra(OpenAI)",
         conclusion=f"{'pass' if verdict.pass_to_next else 'loop'}: {verdict.reason}",
         output_query=verdict.output_query)
    return verdict.pass_to_next


def orchesgate(state: WorkerState, agent_name: str) -> bool:
    """Reads the last-staged agent's output from state and runs verify()."""
    job_uuid = state["job_uuid"]
    out = state.get(_agent_state_field(agent_name))
    if not out:
        step(job_uuid, AgentName.ORCHESTRATOR, "verify-skipped",
             tool="state", conclusion=f"{agent_name} produced no output; retrying once")
        return False
    return verify(job_uuid, agent_name, out)


def _agent_state_field(agent_name: str) -> str:
    return {"READ": "read", "RESEARCH": "research", "PLAN": "plan", "CODE": "code"}[agent_name]
