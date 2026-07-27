-- Polaris Supabase schema
-- Run this in the Supabase SQL editor (Dashboard -> SQL -> New query -> Run)
-- Project: idydoswgklozgioxslbx

create extension if not exists "pgcrypto";

-- users: name, email, github, api_key (single per-user UUID session token),
-- credits (USD numeric balance), and current subscription state.
-- Passwords are no longer used (Google sign-in lives in the frontend).
create table if not exists users (
    id                uuid primary key default gen_random_uuid(),
    name              text,
    email             text unique not null,
    password_hash     text,                                  -- legacy; unused now
    github            text,
    username          text,
    x                 text,
    credits           numeric(12,4) not null default 0.0000,  -- USD balance
    api_key           text unique,
    subscription_id   text,
    subscription_tier text check (subscription_tier is null
                              or subscription_tier in ('starter', 'pro', 'lab')),
    renews_at         timestamptz,
    created_at        timestamptz default now()
);
alter table users add column if not exists name text;
alter table users add column if not exists password_hash text;
alter table users add column if not exists github text;
alter table users add column if not exists username text;
alter table users add column if not exists x text;
alter table users add column if not exists api_key text unique;
alter table users add column if not exists subscription_id   text;
alter table users add column if not exists subscription_tier text
    check (subscription_tier is null or subscription_tier in ('starter', 'pro', 'lab'));
alter table users add column if not exists renews_at timestamptz;
-- credits: int -> numeric(12,4) USD. Existing rows keep value (3 -> $3.0000).
alter table users alter column credits type numeric(12,4) using credits::numeric(12,4);
alter table users alter column credits set default 0.0000;

-- usage_events: append-only ledger of LLM token usage. The backend atomically
-- deducts cost_usd from users.credits on each insert.
create table if not exists usage_events (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references users(id) on delete cascade,
    job_uuid      uuid not null,
    agent         text,
    model         text,
    input_tokens  int  not null default 0,
    output_tokens int  not null default 0,
    cost_usd      numeric(12,6) not null default 0,
    ts            timestamptz not null default now()
);
create index if not exists usage_user_idx on usage_events(user_id, ts desc);
create index if not exists usage_job_idx  on usage_events(job_uuid, ts);

-- papers: one ingest / job per paper attempt
create table if not exists papers (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid references users(id) on delete cascade,
    arxiv_id    text,
    title       text,
    job_uuid    uuid unique not null,
    status      text not null default 'queued',
    error       text,
    code_files  jsonb,
    created_at  timestamptz default now()
);
create index if not exists papers_user_idx on papers(user_id, created_at desc);
create index if not exists papers_job_idx on papers(job_uuid);
create index if not exists papers_arxiv_idx on papers(arxiv_id);

-- traces: durable agent trail (also streamed live via redis)
create table if not exists traces (
    id            uuid primary key default gen_random_uuid(),
    job_uuid      uuid not null,
    agent         text not null,
    kind          text not null,
    step          text,
    tool          text,
    conclusion    text,
    output_query  text,
    ts            timestamptz default now()
);
create index if not exists traces_job_idx on traces(job_uuid, ts);

-- code: one session per job/sessionID
-- progress is constrained to failed | completed | in-progress
-- github_url points at Polaris-Implementations/{repo_name}. Repo identity is
-- deterministic and checked against GitHub before enqueue; multiple sessions
-- may intentionally target the same existing repo.
create table if not exists code (
    id              uuid primary key default gen_random_uuid(),
    session_id      uuid unique not null references papers(job_uuid) on delete cascade,
    user_name       text,
    user_email      text not null,
    user_id         uuid not null references users(id) on delete cascade,
    repo_name       text not null,                 -- Polaris-Implementations/{repo_name}
    progress        text not null default 'in-progress'
                    check (progress in ('failed', 'completed', 'in-progress')),
    execution_mode  text check (execution_mode in ('create', 'modify', 'run')),
    payment_status  text not null default 'unpaid'
                    check (payment_status in ('unpaid', 'pending', 'paid')),
    github_url      text,
    repo_exists     boolean not null default false,
    created_at      timestamptz default now(),
    updated_at      timestamptz default now()
);
create index if not exists code_user_idx on code(user_id, created_at desc);
create index if not exists code_repo_idx on code(repo_name);
-- Older installs may have created a uniqueness constraint on github_url. It
-- must not prevent a later paid modify/run session from targeting that repo.
alter table code drop constraint if exists code_github_url_key;

-- updated_at trigger
create or replace function polaris_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists code_set_updated_at on code;
create trigger code_set_updated_at
  before update on code
  for each row execute function polaris_set_updated_at();
