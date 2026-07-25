"""LangGraph shared state (threaded across all agent nodes).

State carries the job's identity, the parsed paper markdown, and the structured
outputs each upstream agent emits (consumed by the next).  We also carry a
`history` of trace summaries so the orchestrator can ask "is enough progress made".
"""
from __future__ import annotations

from typing import TypedDict


class ReadOutput(TypedDict, total=False):
    aim: str
    built_on: str
    experiments: list[dict]           # [{name, what_yielded}]
    novel_approach: dict               # {description, codeable: bool}
    numbers: list[dict]                # [{claim, value}]
    relevant_citations: list[dict]    # [{arxiv_id, why_relevant}]
    ready: bool
    output_query: str


class ResearchOutput(TypedDict, total=False):
    citations: list[dict]              # [{arxiv_id, what_it_claims, how_used}]
    ready: bool
    output_query: str


class PlanOutput(TypedDict, total=False):
    intends_to_prove: str
    proof_method: str
    researched_usage: str
    deltas_from_base: list[str]
    custom_kernels: dict | None
    plan: list[str]
    ready: bool
    output_query: str


class CodeOutput(TypedDict, total=False):
    files: list[dict]                  # [{path, contents}]
    run_logs: list[dict]               # [{step, stdout, stderr}]
    notes: str
    ready: bool
    output_query: str
    github_url: str
    repo_name: str
    push_error: str


class WorkerState(TypedDict, total=False):
    job_uuid: str
    paper_id: str
    user_id: str
    arxiv_id: str
    top_n_citations: int
    repo_name: str
    github_url: str
    repo_exists: bool
    execution_mode: str
    markdown: str
    read: ReadOutput
    research: ResearchOutput
    plan: PlanOutput
    code: CodeOutput
    approved: bool
    iteration: dict[str, int]          # per-agent iteration counter
    runs: dict[str, int]               # per-agent gate-retry count (agent-bumped)
    history: list[dict]                 # summaries of each agent step
    status: str
    error: str | None
    timer: object | None                 # PipelineTimer instance (populated by main.py)


def mark_agent_run(state: WorkerState, agent: str) -> dict[str, int]:
    """Count every graph invocation, including failed/empty agent attempts.

    The graph uses this counter to force-advance after repeated failures. It
    must be incremented before any early return, otherwise an agent that cannot
    produce output can loop forever at its orchestrator gate.
    """
    runs = dict(state.get("runs") or {})
    runs[agent] = runs.get(agent, 0) + 1
    return runs
