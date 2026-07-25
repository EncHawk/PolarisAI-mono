"""Redis key naming conventions shared between backend and worker."""
from __future__ import annotations


class RedisKeys:
    # Job queue
    JOBS = "polaris:jobs"
    PENDING_JOB = "polaris:pending:{job_uuid}"
    PLAN_CONFIRM = "polaris:plan_confirm:{job_uuid}"

    # Traces
    TRACES_LIST = "polaris:traces:{job_uuid}"
    TRACES_PUB = "polaris:traces:{job_uuid}:pub"

    # Job state hash
    STATE = "polaris:state:{job_uuid}"

    # Markdown cache
    MARKDOWN = "polaris:markdown:{paper_id}"

    # Rate limiting (slowapi uses its own keys)


redis_keys = RedisKeys()