from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    ENVIRONMENT: str = "development"
    DEV_MODE: bool | None = None

    # Empty OAuth values are allowed only for the local dev server. This lets
    # health checks and API dry runs work without accidentally weakening prod.
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""

    JWT_SECRET: str = "dev-only-change-me"
    JWT_ALG: str = "HS256"
    SESSION_TTL_SECONDS: int = 2_592_000

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
    PAYMENT_CHECKOUT_URL: str = ""
    BILLING_WEBHOOK_SECRET: str = ""
    RAZORPAY_KEY_ID: str = ""
    RAZORPAY_KEY_SECRET: str = ""
    RAZORPAY_WEBHOOK_SECRET: str = ""

    REDIS_URL: str = "redis://localhost:6379/0"

    INGEST_TOP_N_CITATIONS: int = 8

    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    RATELIMIT_DEFAULT: str = "120/minute"
    RATELIMIT_AUTH: str = "15/minute"
    RATELIMIT_INGEST: str = "8/minute"

    @field_validator("CORS_ORIGINS")
    @classmethod
    def _split_cors(cls, v: str) -> str:
        return v

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def ratelimit_auth(self) -> str:
        return self.RATELIMIT_AUTH

    @property
    def ratelimit_ingest(self) -> str:
        return self.RATELIMIT_INGEST

    @property
    def is_dev(self) -> bool:
        if self.DEV_MODE is not None:
            return self.DEV_MODE
        return self.ENVIRONMENT.lower() in {"dev", "development", "local", "test"}

    @model_validator(mode="after")
    def require_production_secrets(self) -> "Settings":
        if not self.is_dev:
            missing = [
                name for name, value in {
                    "GOOGLE_CLIENT_ID": self.GOOGLE_CLIENT_ID,
                    "GOOGLE_CLIENT_SECRET": self.GOOGLE_CLIENT_SECRET,
                    "JWT_SECRET": self.JWT_SECRET,
                    "GITHUB_ACCESS_TOKEN": self.GITHUB_ACCESS_TOKEN,
                }.items() if not value or value == "dev-only-change-me"]
            if missing:
                raise ValueError(f"missing production secrets: {', '.join(missing)}")
        return self


BASE_DIR = Path(__file__).resolve().parent.parent


@lru_cache
def get_settings() -> Settings:
    return Settings()
