"""LLM token-usage reporting.

A langchain callback attached by `make_llm` that runs on every LLM call. It
extracts input/output tokens and POSTs them once to the backend's
`/internal/usage` endpoint, where cost is computed ($0.05 / 100k tokens) and
atomically deducted from users.credits.

`user_id` lives in a contextvar set once per job at the top of `run_one` (the
langgraph pipeline runs one job at a time per worker process).
"""
from __future__ import annotations

from contextvars import ContextVar
from typing import Any

import httpx
from langchain_core.callbacks import BaseCallbackHandler

from worker.config import get_settings

# Set once per job by run_one(); read by every UsageHandler instance.
_user_id_ctx: ContextVar[str] = ContextVar("polaris_user_id", default="")
_job_uuid_ctx: ContextVar[str] = ContextVar("polaris_job_uuid", default="")


def set_job_context(user_id: str, job_uuid: str) -> None:
    _user_id_ctx.set(user_id or "")
    _job_uuid_ctx.set(job_uuid or "")


class UsageHandler(BaseCallbackHandler):
    """Report LLM token usage to the backend after each LLM end."""

    def __init__(self, agent: str | None) -> None:
        self._agent = agent

    def on_llm_end(self, response: Any, **_kwargs: Any) -> None:
        user_id = _user_id_ctx.get()
        job_uuid = _job_uuid_ctx.get()
        if not user_id or not job_uuid:
            return  # nothing to attribute the usage to (local dev / no job)

        # DeepInfra's OpenAI-compatible endpoint lands token counts in
        # llm_output["token_usage"] (and message.usage_metadata on chat models).
        in_t = 0
        out_t = 0
        model: str | None = None
        llm_out = getattr(response, "llm_output", None) or {}
        if isinstance(llm_out, dict):
            tu = llm_out.get("token_usage") or {}
            in_t = int(tu.get("prompt_tokens", 0) or 0)
            out_t = int(tu.get("completion_tokens", 0) or 0)
            model = llm_out.get("model_name")

        # Fall back to message.usage_metadata on chat generations (langchain-core).
        if in_t == 0 and out_t == 0:
            for batch in getattr(response, "generations", []) or []:
                for gen in batch:
                    msg = getattr(gen, "message", None)
                    if msg is None:
                        continue
                    um = getattr(msg, "usage_metadata", None)
                    if isinstance(um, dict):
                        in_t += int(um.get("input_tokens", 0) or 0)
                        out_t += int(um.get("output_tokens", 0) or 0)
                    if not model:
                        nm = getattr(msg, "name", "") or ""
                        if nm:
                            model = nm

        if in_t == 0 and out_t == 0:
            return

        settings = get_settings()
        worker_secret = settings.WORKER_SECRET
        if not settings.WORKER_SECRET and not settings.is_dev:
            # In production we must report usage; absence is a config bug.
            return
        if not worker_secret:
            # Dev with no secret → still try (backend dev accepts it via header
            # check, which is bypassed only if WORKER_SECRET unset on backend).
            # Either way we shouldn't crash the run.
            return

        backend = (get_settings().BACKEND_URL or "").rstrip("/")
        if not backend:
            return

        try:
            httpx.post(
                f"{backend}/internal/usage",
                json={
                    "user_id": user_id,
                    "job_uuid": job_uuid,
                    "agent": self._agent,
                    "model": model,
                    "input_tokens": in_t,
                    "output_tokens": out_t,
                },
                headers={"X-Worker-Secret": worker_secret},
                timeout=10.0,
            )
        except Exception:
            # Billing must never block the reproduction pipeline.
            pass


_ = Any  # for type checkers shy of forward refs in callback signatures