-- Polaris Supabase schema
-- Run this in the Supabase SQL editor (Dashboard -> SQL -> New query -> Run)
-- Project: idydoswgklozgioxslbx

create extension if not exists "pgcrypto";

-- users: name, email, salted password, github
create table if not exists users (
    id            uuid primary key default gen_random_uuid(),
    name          text,
    email         text unique not null,
    password_hash text,                 -- bcrypt salted hash; null for OAuth-only users
    github        text,
    username      text,
    x             text,
    credits       int not null default 3,
    api_key       text unique,
    created_at    timestamptz default now()
);
alter table users add column if not exists name text;
alter table users add column if not exists password_hash text;
alter table users add column if not exists github text;
alter table users add column if not exists username text;
alter table users add column if not exists x text;
alter table users add column if not exists credits int not null default 3;
alter table users add column if not exists api_key text unique;

-- papers: one ingest / job per paper attempt
create table if not exists papers (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid references users(id) on delete cascade,
    arxiv_id    text,
    title       text,
    job_uuid    uuid unique not null,
    markdown    text,
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
-- github_url points at Polaris-Implementations/{repo_name} (unique: no duplicates)
create table if not exists code (
    id              uuid primary key default gen_random_uuid(),
    session_id      uuid unique not null,          -- same as papers.job_uuid
    user_name       text,
    user_email      text not null,
    user_id         uuid not null references users(id) on delete cascade,
    repo_name       text not null,                 -- Polaris-Implementations/{repo_name}
    progress        text not null default 'in-progress'
                    check (progress in ('failed', 'completed', 'in-progress')),
    execution_mode  text check (execution_mode in ('create', 'modify', 'run')),
    payment_status  text not null default 'unpaid'
                    check (payment_status in ('unpaid', 'pending', 'paid')),
    github_url      text unique,
    repo_exists     boolean not null default false,
    created_at      timestamptz default now(),
    updated_at      timestamptz default now()
);
create index if not exists code_user_idx on code(user_id, created_at desc);
create index if not exists code_repo_idx on code(repo_name);
create unique index if not exists code_repo_name_unique on code(repo_name)
    where progress = 'completed' and github_url is not null;

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