"""RESEARCH agent.

For each relevant citation the READ agent surfaced, fetch that citation's paper
(via the arxiv tool -- abstracts are plentiful) and produce:
  - what_does_this_citation_do_and_claim
  - how_does_this_paper_use_that_citation
"""
from __future__ import annotations

import json
import re

from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field
from shared.trace import AgentName

from worker._util import parse_json_or_none, update_paper_status
from worker.config import get_settings
from worker.models import make_llm
from worker.state import WorkerState, mark_agent_run
from worker.tools.arxiv_citation import search_id, search_title
from worker.traces import output, status, step


class CitationNote(BaseModel):
    arxiv_id: str
    what_it_claims: str
    how_used: str = ""

class ResearchResult(BaseModel):
    citations: list[CitationNote] = Field(default_factory=list)
    ready: bool = False
    output_query: str = ""


SYSTEM = """You are the RESEARCH agent for an automated paper-reproduction pipeline.
The READ agent already gave you its understanding of the main paper and its list of
'relevant_citations'.  For each citation you will be handed its abstract (fetched via
the arxiv tool). Produce:
  - what_it_claims : what the cited paper does AND claims (a vague READ, not a full READ)
  - how_used       : how the main paper uses this citation in its approach
Be concise. Set ready=True once you've covered ALL the citations provided.
Output ONLY valid JSON. Do NOT include HTML, XML, or markdown tags.
"""


def run_research(state: WorkerState) -> dict:
    job_uuid = state["job_uuid"]
    paper_id = state.get("paper_id", "")
    runs = mark_agent_run(state, "RESEARCH")
    update_paper_status(paper_id, "research")
    status(job_uuid, "research")
    s = get_settings()

    read = state.get("read") or {}
    cits = read.get("relevant_citations") or []
    top_n = state.get("top_n_citations") or s.ARXIV_MAX_CITATIONS
    cits = cits[:min(top_n, s.ARXIV_MAX_CITATIONS)]

    enriched: list[dict] = []
    for c in cits:
        aid = c.get("arxiv_id") or ""
        step(job_uuid, AgentName.RESEARCH, "fetch-citation",
             tool="arxiv_citation",
             conclusion=f"looking up {aid!r}: {c.get('why_relevant','')[:80]}",
             output_query=aid)
        meta = search_id(aid) if aid else None
        if meta is None and c.get("why_relevant"):
            meta = search_title(str(c.get("why_relevant")).split(":", 1)[0])
        enriched.append({
            "arxiv_id": aid,
            "title": meta.get("title") if meta else "",
            "abstract": (meta.get("abstract") if meta else "")[:4000],
            "why_relevant": c.get("why_relevant", ""),
        })

    llm = make_llm("RESEARCH", job_uuid)
    prompt = ChatPromptTemplate.from_messages([
        ("system", SYSTEM),
        ("human", "MAIN PAPER AIM:\n{aim}\n\nMAIN PAPER NOVEL APPROACH:\n{novel}\n\n"
                  "CITATIONS (with abstracts):\n{citations}\n\nLatest draft:\n{draft}"),
    ])

    draft: ResearchResult | None = None
    prev_dump: dict | None = None
    cit_blob = json.dumps(enriched, indent=2)[:40000]
    novel = json.dumps(read.get("novel_approach", {}))[:2000]

    for i in range(min(s.AGENT_MAX_STEPS, 3)):
        step(job_uuid, AgentName.RESEARCH, f"research-iter-{i+1}",
             tool="llm:DeepInfra(OpenAI)",
             conclusion=f"covered {len(draft.citations) if draft else 0} citations",
             output_query=(draft.output_query if draft else ""))
        try:
            raw = llm.invoke(prompt.format_messages(
                aim=str(read.get("aim", ""))[:2000],
                novel=novel,
                citations=cit_blob,
                draft=(draft.model_dump_json() if draft else "(none)"),
            ))
            text = str(getattr(raw, "content", raw))
            text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL)
            result = parse_json_or_none(text, ResearchResult)
            if result is None:
                raise ValueError(f"Could not parse ResearchResult from response")
        except Exception as e:
            step(job_uuid, AgentName.RESEARCH, f"research-iter-{i+1}-failed",
                 tool="llm:DeepInfra(OpenAI)", conclusion=f"call failed: {e}")
            continue

        current_dump = result.model_dump()
        if prev_dump and current_dump == prev_dump and not result.ready:
            step(job_uuid, AgentName.RESEARCH, f"research-iter-{i+1}-stuck",
                 tool="llm:DeepInfra(OpenAI)",
                 conclusion="duplicate output detected, breaking loop")
            draft = result
            break
        prev_dump = current_dump
        draft = result

        output(job_uuid, AgentName.RESEARCH,
               conclusion=f"iter {i+1}: covered {len(draft.citations)} citations "
                          f"ready={draft.ready}",
               output_query=draft.output_query)
        if draft.ready or i == 2:
            break

    # Enforce minimum citation coverage: never return 0 citations when papers were provided
    if draft:
        covered_ids = {n.arxiv_id for n in draft.citations}
        for c in enriched:
            aid = c.get("arxiv_id") or ""
            if aid and aid not in covered_ids:
                draft.citations.append(CitationNote(
                    arxiv_id=aid,
                    what_it_claims="citation analysis unavailable",
                    how_used="",
                ))
    elif enriched:
        draft = ResearchResult(
            citations=[CitationNote(arxiv_id=c.get("arxiv_id", ""),
                                     what_it_claims="citation analysis unavailable",
                                     how_used="")
                       for c in enriched],
            ready=False,
            output_query="research produced no structured output",
        )

    notes = []
    if draft:
        for n in draft.citations:
            notes.append({"arxiv_id": n.arxiv_id,
                          "what_it_claims": n.what_it_claims,
                          "how_used": n.how_used})
    return {"research": {
        "citations": notes,
        "ready": draft.ready if draft else False,
        "output_query": draft.output_query if draft else "research produced no output",
    }, "runs": runs}
