"""Chat model factory.

Uses DeepInfra's OpenAI-compatible endpoint (api.deepinfra.com/v1/openai) because it
respects timeouts and handles large structured outputs more reliably than the
legacy ChatDeepInfra client. Per-agent model overrides via `*_MODEL` env vars are
supported; the model path is whatever DeepInfra hosts (e.g. deepseek-ai/DeepSeek-V4-Flash).
"""
from __future__ import annotations

from langchain_openai import ChatOpenAI

from worker.config import get_settings


def make_llm(agent_name: str, job_uuid: str, temperature: float | None = None) -> ChatOpenAI:
    s = get_settings()
    api_key = s.DEEPINFRA_API_TOKEN
    if not api_key:
        raise RuntimeError("DEEPINFRA_API_TOKEN not set")
    model = s.model_for(agent_name)
    kwargs: dict = {
        "model": model,
        "api_key": api_key,
        "base_url": "https://api.deepinfra.com/v1/openai",
        "temperature": temperature if temperature is not None else 0.2,
        "max_retries": 1,
        "timeout": 120,
    }
    return ChatOpenAI(**kwargs)
