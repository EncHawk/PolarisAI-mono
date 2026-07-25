"""Structured trace event schema.

A trace captures what an agent did at a high level, NOT raw model thinking:
- agent   : which agent produced this
- step    : short human description of what this step is
- tool    : the tool being used (or "" if none)
- conclusion : what the agent concluded from this step
- output_query : what the agent wants / intends to look at next
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field


class AgentName(str, Enum):
    READ = "READ"
    RESEARCH = "RESEARCH"
    PLAN = "PLAN"
    CODE = "CODE"
    ORCHESTRATOR = "ORCHESTRATOR"
    SYSTEM = "SYSTEM"


class TraceKind(str, Enum):
    STEP = "step"          # a normal step / tool use
    OUTPUT = "output"      # an agent's final structured output for its stage
    STATUS = "status"       # status change (queued, read, ..., done, failed)
    AWAIT_USER = "await_user"  # blocked waiting on user (e.g. plan approval)
    ERROR = "error"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class TraceEvent(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    ts: str = Field(default_factory=_now_iso)
    job_uuid: str
    agent: AgentName
    kind: TraceKind = TraceKind.STEP
    step: str = ""
    tool: str = ""
    conclusion: str = ""
    output_query: str = ""

    def line(self) -> str:
        """Single-line JSON suitable for SSE `data:` frames and redis lists."""
        return self.model_dump_json()
