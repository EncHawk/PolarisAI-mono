# polaris-shared

Tiny package imported by both `backend/` and `worker-agent/`:
- `shared.trace.TraceEvent` -- the structured trace schema (agent/kind/step/tool/conclusion/output_query)
- `shared.redis_keys.redis_keys` -- shared key naming for the job queue, trace list, pub/sub fan-out,
  plan-confirm list and job state hash.

Keeps the backend's `/events` SSE in sync with what the worker writes.