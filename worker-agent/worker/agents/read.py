"""READ agent.

Input  -> paper markdown.
Output -> structured understanding: aim, built_on, experiments/ablations, novel
          approach (and codeable?), new numbers, and the most relevant citations.
Each iteration logs a trace (what step, what tool, conclusion, what it wants next).
"""
from __future__ import annotations

from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field
from shared.trace import AgentName

from worker._util import update_paper_status
from worker.config import get_settings
from worker.models import make_llm
from worker.state import WorkerState, mark_agent_run
from worker.traces import output, status, step


class ExperimentFinding(BaseModel):
    name: str
    what_yielded: str = ""

class NumberClaim(BaseModel):
    claim: str
    value: str = ""

class CitationRef(BaseModel):
    arxiv_id: str
    why_relevant: str = ""

class NovelApproach(BaseModel):
    description: str
    codeable: bool

class ReadResult(BaseModel):
    """Final structured result of the READ agent. `ready=True` => done iterating."""
    aim: str
    built_on: str
    experiments: list[ExperimentFinding] = Field(default_factory=list)
    novel_approach: NovelApproach
    numbers: list[NumberClaim] = Field(default_factory=list)
    relevant_citations: list[CitationRef] = Field(default_factory=list)
    ready: bool = False
    output_query: str = ""      # what it wants to clarify / look at next


SYSTEM = """You are the READ agent for an automated research-paper reproduction pipeline.
Your job is to read the paper's markdown and extract a precise structured understanding:

1. aim         - what do they aim to solve?
2. built_on   - what they built on top of (prior work / base method)
3. experiments - experiments / ablation studies / misc studies and what each yielded
4. novel_approach - the novel approach introduced + whether it's codeable (true/false)
5. numbers     - improvements (or demotions) proposed in the paper
6. relevant_citations - the most relevant citations (arxiv_id if known, why_relevant)
                       these will feed the RESEARCH agent which fetches their implementations

Work in a loop: emit your best partial result each call. Set `ready=True` only when you've
read enough to be conficent the next agent can act. In `output_query` put a one-sentence
note on what you'd want to look at next unless ready.
"""


def build_prompt():
    return ChatPromptTemplate.from_messages([
        ("system", SYSTEM),
        ("human", "PAPER MARKDOWN:\n{markdown}\n\nLatest draft:\n{draft}"),
    ])


def run_read(state: WorkerState) -> dict:
    job_uuid = state["job_uuid"]
    paper_id = state.get("paper_id", "")
    markdown = state.get("markdown") or ""
    runs = mark_agent_run(state, "READ")
    if not markdown:
        return {"read": {}, "runs": runs, "error": "no markdown"}

    update_paper_status(paper_id, "read")
    status(job_uuid, "read")
    s = get_settings()

    llm = make_llm("READ", job_uuid)
    structured = llm.with_structured_output(ReadResult)
    prompt = build_prompt()

    draft: ReadResult | None = None
    for i in range(s.AGENT_MAX_STEPS):
        step(job_uuid, AgentName.READ, f"read-iter-{i+1}",
             tool="llm:DeepInfra(OpenAI)",
             conclusion=(draft.aim if draft else "first pass"),
             output_query=(draft.output_query if draft else "decompose paper"))
        try:
            result: ReadResult = structured.invoke(prompt.format_messages(
                markdown=markdown[:60000],
                draft=(draft.model_dump_json() if draft else "(none yet)"),
            ))
        except Exception as e:
            step(job_uuid, AgentName.READ, f"read-iter-{i+1}-failed",
                 tool="llm:DeepInfra(OpenAI)", conclusion=f"call failed: {e}")
            break
        draft = result
        output(job_uuid, AgentName.READ,
               conclusion=f"iter {i+1}: aim='{result.aim[:80]}' "
                         f"ready={result.ready} citations={len(result.relevant_citations)}",
               output_query=result.output_query)
        if result.ready or i == s.AGENT_MAX_STEPS - 1:
            break

    if draft is None:
        return {"read": {}, "runs": runs, "error": "read produced no output"}

    return {
        "read": {
            "aim": draft.aim,
            "built_on": draft.built_on,
            "experiments": [e.model_dump() for e in draft.experiments],
            "novel_approach": draft.novel_approach.model_dump(),
            "numbers": [n.model_dump() for n in draft.numbers],
            "relevant_citations": [c.model_dump() for c in draft.relevant_citations],
            "ready": draft.ready,
            "output_query": draft.output_query,
        },
        "runs": runs,
    }
