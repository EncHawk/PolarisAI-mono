# polaris-worker

LangGraph worker that reproduces a research paper. Pops jobs from `polaris:jobs`,
runs the READ -> RESEARCH -> PLAN -> CODE pipeline (each gated by an orchestrator
verify node) and writes structured traces to Redis (live) + Supabase (durable).

## Agents
- **READ**       : aim, built_on, experiments/ablations, novel_approach+codeable, numbers, relevant citations
- **RESEARCH**   : per-citation abstract fetch (arxiv API) -> what it claims + how the paper uses it
- **PLAN**       : intends_to_prove, proof_method, deltas, custom_kernels, plan() todo; then blocks on user approval
- **CODE**       : writes one-file-per-concern PyTorch raw-python code into a Daytona sandbox, runs, reads logs
- CODE publishes from inside the sandbox: it initializes/clones the deterministic GitHub repo,
  commits generated files, and pushes to `Polaris-Implementations/{repo_name}` using an askpass
  credential that is never placed in the remote URL or trace output.
- **ORCHESTRATOR**: between agents, judges if the agent's output is good enough to advance or loop.

Traces are `{ts, agent, kind, step, tool, conclusion, output_query}` -- never raw model thinking.
All agents default to `deepseek-ai/DeepSeek-V4-Flash` on DeepInfra (override via `*_MODEL` env).
The DeepInfra request carries `extra_body.cache_key = <job_uuid>` for prompt-cache keying per job.

In development (`ENVIRONMENT=development`, `DEV_MODE=true`, or `POLARIS_DEV_LOGGING=true`),
the worker appends structured timing and high-level trace records to the repository-root
`logs.txt`. The file is not written when the environment is production.

Agent failures are bounded: every graph invocation counts toward the retry cap, empty output
fails the job instead of looping forever, and the queue consumer uses finite Redis polling so
an idle connection reset does not kill the worker.

## Run
```
cp .env.example .env   # fill DEEPINFRA_API_TOKEN, redis, supabase, DAYTONA_*
uv venv && uv pip install -e ../shared && uv pip install -e .
uv run python -m worker.main
```

## Sandboxed CODE
The CODE agent uses the `daytona-sdk` against `DAYTONA_API_KEY` / `DAYTONA_API_URL` /
`DAYTONA_TARGET`. If those are unset, it falls back to a local tempdir sandbox so the
graph still runs end-to-end in dev.

## Note on model availability
`deepseek-ai/DeepSeek-V4-Flash` is the requested default; if DeepInfra doesn't host that
exact id, set `DEFAULT_MODEL` (or per-agent `READ_MODEL` etc.) to one available on DeepInfra.
