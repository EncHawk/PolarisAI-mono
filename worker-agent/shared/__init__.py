"""Shared trace types for worker + backend."""
from __future__ import annotations

import json
from datetime import UTC, datetime
from enum import Enum


class AgentName(Enum):
    SYSTEM = "SYSTEM"
    READ = "READ"
    RESEARCH = "RESEARCH"
    PLAN = "PLAN"
    CODE = "CODE"
    ORCHESTRATOR = "ORCHESTRATOR"


class TraceKind(Enum):
    STEP = "STEP"
    OUTPUT = "OUTPUT"
    STATUS = "STATUS"
    AWAIT_USER = "AWAIT_USER"
    ERROR = "ERROR"


class TraceEvent:
    def __init__(
        self,
        job_uuid: str,
        agent: AgentName,
        kind: TraceKind,
        step: str = "",
        tool: str = "",
        conclusion: str = "",
        output_query: str = "",
        ts: datetime | None = None,
    ):
        self.job_uuid = job_uuid
        self.agent = agent
        self.kind = kind
        self.step = step
        self.tool = tool
        self.conclusion = conclusion
        self.output_query = output_query
        self.ts = ts or datetime.now(UTC)

    def line(self) -> str:
        return json.dumps({
            "job_uuid": self.job_uuid,
            "agent": self.agent.value,
            "kind": self.kind.value,
            "step": self.step,
            "tool": self.tool,
            "conclusion": self.conclusion,
            "output_query": self.output_query,
            "ts": self.ts.isoformat(),
        }, default=str)
