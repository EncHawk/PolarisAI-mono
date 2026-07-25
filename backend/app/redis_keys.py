"""Redis key naming conventions shared between backend and worker."""
from __future__ import annotations


class RedisKeys:
    JOBS = "polaris:jobs"
    PENDING_JOB = "polaris:pending:{job_uuid}"
    PLAN_CONFIRM = "polaris:plan_confirm:{job_uuid}"
    TRACES_LIST = "polaris:traces:{job_uuid}"
    TRACES_PUB = "polaris:traces:{job_uuid}:pub"
    STATE = "polaris:state:{job_uuid}"
    MARKDOWN = "polaris:markdown:{paper_id}"


redis_keys = RedisKeys()
