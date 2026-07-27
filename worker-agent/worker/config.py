from __future__ import annotations

from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    ENVIRONMENT: str = "development"
    DEV_MODE: bool | None = None

    # DeepInfra
    DEEPINFRA_API_TOKEN: str = ""
    DEFAULT_MODEL: str = "deepseek-ai/DeepSeek-V4-Flash"
    READ_MODEL: str = ""
    RESEARCH_MODEL: str = ""
    PLAN_MODEL: str = ""
    CODE_MODEL: str = ""
    ORCHESTRATOR_MODEL: str = ""

    # Keep a stuck model bounded. Individual agents may use a smaller cap for
    # citation research and planning, but none can silently spin for 12 calls.
    AGENT_MAX_STEPS: int = 4

    # Upstash Redis REST (HTTPS, connectionless). Set both to use the managed
    # Upstash database; the worker no longer ships a local redis-py client.
    UPSTASH_REDIS_REST_URL: str = ""
    UPSTASH_REDIS_REST_TOKEN: str = ""

    # Backend endpoints for usage reporting. WORKER_SECRET matches the backend's
    # WORKER_SECRET and is sent on the X-Worker-Secret header.
    BACKEND_URL: str = "http://localhost:3000"
    WORKER_SECRET: str = ""

    SUPABASE_URL: str = ""
    SUPABASE_KEY: str = Field(
        "", validation_alias=AliasChoices("SUPABASE_KEY", "SUPABASE_SECRET_KEY")
    )

    GITHUB_ACCESS_TOKEN: str = Field(
        "", validation_alias=AliasChoices("GITHUB_ACCESS_TOKEN", "GITHUB_ACCESS_KEY")
    )
    GITHUB_ORG: str = "Polaris-Implementations"
    GITHUB_API_URL: str = "https://api.github.com"
    GITHUB_REPO_PRIVATE: bool = False

    ARXIV_MAX_CITATIONS: int = 8

    # Daytona
    DAYTONA_API_KEY: str = ""
    DAYTONA_API_URL: str = Field(
        "", validation_alias=AliasChoices("DAYTONA_API_URL", "DAYTONA_URL")
    )
    DAYTONA_TARGET: str = ""  # e.g. "global" for app.daytona.io
    DAYTONA_SANDBOX_NAME: str = "Polaris"  # name of the pre-existing sandbox to reuse
    DAYTONA_WORKDIR: str = "/home/daytona"  # directory inside the sandbox to write files into

    def model_for(self, agent: str) -> str:
        """Pick per-agent model or fall back to DEFAULT_MODEL."""
        val = getattr(self, f"{agent}_MODEL", "")
        return val or self.DEFAULT_MODEL

    @property
    def is_dev(self) -> bool:
        if self.DEV_MODE is not None:
            return self.DEV_MODE
        return self.ENVIRONMENT.lower() in {"dev", "development", "local", "test"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
