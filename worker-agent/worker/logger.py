"""Pipeline timing logger.

Writes human-readable + JSON lines to a log file so you can see exactly how
long each agent stage took, when the orchestrator gated/looped, and the total
wall-clock time from job pickup to done/failed.
"""
from __future__ import annotations

import json
import os
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

_DEFAULT_LOG = Path(__file__).resolve().parents[2] / "logs.txt"


def _dev_logging_enabled() -> bool:
    explicit = os.getenv("POLARIS_DEV_LOGGING")
    if explicit is not None:
        return explicit.lower() in {"1", "true", "yes", "on"}
    dev_mode = os.getenv("DEV_MODE")
    if dev_mode is not None:
        return dev_mode.lower() in {"1", "true", "yes", "on"}
    environment = os.getenv("POLARIS_ENV", os.getenv("ENVIRONMENT", "development"))
    return environment.lower() in {"dev", "development", "local", "test"}


def write_dev_event(event: str, **fields: Any) -> None:
    """Append a structured event to logs.txt only in development mode."""
    if not _dev_logging_enabled():
        return
    path = Path(os.getenv("POLARIS_LOG_PATH", str(_DEFAULT_LOG)))
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "ts": datetime.now(UTC).isoformat(),
        "level": "INFO",
        "event": event,
        **fields,
    }
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, default=str) + "\n")


class PipelineTimer:
    def __init__(self, job_uuid: str, log_path: Path | str | None = None) -> None:
        self.job_uuid = job_uuid
        self.enabled = _dev_logging_enabled()
        self.log_path = Path(log_path or os.getenv("POLARIS_LOG_PATH", str(_DEFAULT_LOG)))
        self._t0: float | None = None
        self._agent_t0: dict[str, float] = {}
        self._ensure_open()

    def _ensure_open(self) -> None:
        if not self.enabled:
            return
        # rotate if exists > 5 MB
        if self.log_path.exists() and self.log_path.stat().st_size > 5_242_880:
            self.log_path.rename(self.log_path.with_suffix(".log.old"))

    def _write(self, level: str, msg: str, **extra: Any) -> None:
        if not self.enabled:
            return
        ts = datetime.now(UTC).isoformat()
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps({"ts": ts, "job": self.job_uuid, "level": level, "msg": msg, **extra}, default=str)
        with open(self.log_path, "a", encoding="utf-8") as f:
            f.write(line + "\n")

    def job_start(self) -> None:
        self._t0 = time.perf_counter()
        self._write("INFO", "pipeline start", event="job_start")

    def agent_enter(self, agent: str) -> None:
        self._agent_t0[agent] = time.perf_counter()
        self._write("INFO", f"enter {agent}", event="agent_enter", agent=agent)

    def agent_exit(self, agent: str, verdict: str = "") -> None:
        t0 = self._agent_t0.pop(agent, None)
        elapsed = round(time.perf_counter() - t0, 2) if t0 else None
        self._write("INFO", f"exit {agent}", event="agent_exit", agent=agent, elapsed_seconds=elapsed, verdict=verdict)

    def gate(self, agent: str, decision: str, reason: str = "") -> None:
        self._write("INFO", f"gate {agent} -> {decision}", event="gate", agent=agent, decision=decision, reason=reason)

    def approval_wait_start(self) -> None:
        self._write("INFO", "waiting for user approval", event="approval_wait_start")

    def approval_received(self, approved: bool, feedback: str = "") -> None:
        self._write("INFO", f"approval received: {approved}", event="approval_received", approved=approved, feedback=feedback)

    def job_end(self, status: str, error: str | None = None) -> None:
        total = round(time.perf_counter() - self._t0, 2) if self._t0 else None
        self._write("INFO", f"pipeline end: {status}", event="job_end", status=status, total_seconds=total, error=error)

    def code_run(self, step_name: str, rc: int, elapsed: float) -> None:
        self._write("INFO", f"code run {step_name} rc={rc}", event="code_run", step=step_name, rc=rc, elapsed_seconds=round(elapsed, 2))

    def llm_call(self, agent: str, phase: str, elapsed: float | None = None, error: str = "") -> None:
        self._write(
            "INFO",
            f"llm {phase}: {agent}",
            event="llm_call",
            agent=agent,
            phase=phase,
            elapsed_seconds=round(elapsed, 2) if elapsed is not None else None,
            error=error,
        )
