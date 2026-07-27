# polaris-backend

FastAPI backend for Polaris. Owns the one-shot Google ID-token exchange (`/auth/exchange`),
the API-key session model, `/ingest`, `/events` (SSE), `/list`, `/plan` approval,
Razorpay subscription billing -> USD credit grants, and an internal usage endpoint
the worker reports LLM token counts to.

## Stack
- FastAPI + Uvicorn, pydantic-settings
- One-time Google ID-token verification -> per-user UUID `api_key`, rotated on exchange
- USD `numeric(12,4)` credit balance on `users.credits`, atomically deducted per LLM call
- Append-only `usage_events` ledger (one row per agent/model LLM call)
- Supabase for users / papers / code sessions / traces / usage; Redis for the job queue + live trace stream
- GitHub REST duplicate detection and sandbox-originated pushes to `Polaris-Implementations`
- LlamaIndex for PDF -> markdown
- slowapi rate-limits + cachetools TTL LRU for the "does this user exist" check
- Razorpay subscriptions ($5 / $20 / $200 per month) -> monthly credit grants

## Run
```
cp ../.env.example .env          # then fill GOOGLE_CLIENT_ID, WORKER_SECRET, supabase, redis, razorpay
uv venv && uv pip install -e ../shared && uv pip install -e .
uv run uvicorn app.main:app --reload --port 3000
```

## Auth model
Google sign-in lives entirely in the frontend (NextJS). The frontend POSTs the
Google ID token to `POST /auth/exchange` once; the backend verifies it,
upserts the user, rotates `users.api_key`, and returns it. The NextJS layer
stores the api_key in an httpOnly cookie and forwards it as
`Authorization: Bearer …` on subsequent calls. The backend never touches
Google again after that exchange.

## Credits & billing
- `users.credits` is a USD numeric balance.
- Rate: $0.05 per 100k tokens (input + output), charged at run completion via
  the worker's per-LLM-call reports to `/internal/usage` (see `auth/sessions.py`
  `record_usage`).
- Razorpay subscriptions grant the plan's USD value (`5` / `20` / `200`) on
  checkout capture and on each recurring webhook capture.
- `/ingest` no longer deducts a credit; it only requires a positive balance
  (`require_positive_balance`) to start the run.

## Endpoints
- `POST /auth/exchange`     `{ id_token }` -> api_key (one-time Google verification)
- `GET  /auth/account`       profile + USD balance + subscription state
- `POST /auth/logout`        nulls the caller's api_key row
- `POST /ingest`             `{ arxiv_id | arxiv_url | pdf_url }`
- `GET  /code/{job_uuid}`    code session + payment state + existing GitHub contents
- `POST /code/{job_uuid}/choice`      `{ action: "modify" | "run" }`
- `POST /code/{job_uuid}/start`       enqueue after payment
- `POST /code/{job_uuid}/pay-dev`      dev-only payment skip
- `POST /code/{job_uuid}/payment-webhook` provider-neutral signed payment callback
- `POST /billing/checkout`             `{ plan }` -> Razorpay order (grants credits on capture)
- `POST /billing/verify`               signature verify + grant credits + mark job paid
- `POST /billing/razorpay/webhook`     recurring capture / subscription.charge -> grant credits
- `GET  /events/{job_uuid}`            SSE stream of worker traces
- `GET  /list`                          user's papers
- `POST /plan/{job_uuid}/approve`      `{ approved, feedback }` -> unblocks PLAN gate
- `POST /internal/usage`               worker -> backend token report (X-Worker-Secret)
- `GET  /internal/usage/{job_uuid}`    per-job usage breakdown for the signed-in user

## Schema
See `db/schema.sql` and `supabase/migrations/*.sql`. `users.credits` is
`numeric(12,4)` USD, `users.subscription_id/tier/renews_at` track the active
subscription, and `usage_events` is the append-only LLM token ledger.
`repo_name` is deterministic from the arXiv ID; GitHub is checked before
ingest and again before push so duplicate repo creation is race-safe.

## Razorpay setup
Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`.
Point Razorpay's webhook endpoint at `/billing/razorpay/webhook` and subscribe
to `payment.captured`, `order.paid`, and `subscription.charged`. On each capture
the backend grants the linked plan's USD value to the user's credit balance.