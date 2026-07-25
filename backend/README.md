# polaris-backend

FastAPI backend for polaris. Owns auth (Google OAuth), /ingest, /events (SSE), /list and /plan approval.
Downloads + parses arxiv PDFs via LlamaIndex, then enqueues the resulting markdown onto Redis for the worker.

## Stack
- FastAPI + Uvicorn, pydantic-settings
- Google ID-token verification -> own HS256 JWT session cookie
- Supabase for users / papers / code sessions / traces; Redis for the job queue + live trace stream
- GitHub REST duplicate detection and sandbox-originated pushes to `Polaris-Implementations`
- LlamaIndex for PDF -> markdown
- slowapi rate-limits + a cachetools TTL LRU for "does this user exist"
- Stripe Checkout for Starter ($1 early access) and Pro ($20/month), with signed webhook fulfillment

## Run
```
cp .env.example .env   # then fill GOOGLE_CLIENT_SECRET, JWT_SECRET, supabase, redis
uv venv && uv pip install -e ../shared && uv pip install -e .
uv run uvicorn app.main:app --reload --port 3000
```

## Endpoints
- `POST /auth/google`      `{ id_token }` -> session cookie + user
- `GET  /auth/me`
- `POST /auth/logout`
- `POST /ingest`           `{ arxiv_id | arxiv_url | pdf_url }` -> session + repo/payment state
- `GET /code/{job_uuid}`  code session, payment state, and existing GitHub repo contents
- `POST /code/{job_uuid}/choice` `{ action: "modify" | "run" }` for an existing repo
- `POST /code/{job_uuid}/start` enqueue after the billing webhook marks the session paid
- `POST /code/{job_uuid}/payment-webhook` provider-neutral signed payment callback
- `POST /billing/checkout` `{ plan: "starter" | "pro", job_uuid? }` -> Stripe Checkout URL
- `POST /billing/stripe/webhook` -> verifies Stripe events and marks linked code sessions paid
- `GET  /events/{job_uuid}` SSE stream of worker traces for this job
- `GET  /list`             user's papers
- `POST /plan/{job_uuid}/approve` `{ approved, feedback }` -> unblocks the worker's PLAN gate

## Schema
See `db/schema.sql` for the Supabase tables. Passwords are stored as salted bcrypt
`password_hash` values, never plaintext. `repo_name` is deterministic from the arXiv ID;
GitHub is checked before ingest and again before push so duplicate repository creation is race-safe.

## Stripe setup

Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` for production. `STRIPE_STARTER_PRICE_ID`
and `STRIPE_PRO_PRICE_ID` are recommended, but optional: when omitted, the backend creates
inline price data for local testing. Point Stripe's webhook endpoint at
`/billing/stripe/webhook` and subscribe to `checkout.session.completed` and
`checkout.session.async_payment_succeeded`.
