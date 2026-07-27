-- Credits become USD balance (numeric), plus subscription state and an
-- append-only usage ledger for token-based billing.
-- Existing users (credits=3 integer) are migrated to $3.0000 USD.

-- 1) credits: int -> numeric(12,4) USD. Existing rows keep their numeric value
--    (a user with credits=3 reads as $3.0000). New default is $0.0000.
alter table users alter column credits type numeric(12,4) using credits::numeric(12,4);
alter table users alter column credits set default 0.0000;

-- 2) Subscription state mirrored on the user row for quick reads.
alter table users add column if not exists subscription_id    text;
alter table users add column if not exists subscription_tier text
    check (subscription_tier is null or subscription_tier in ('starter', 'pro', 'lab'));
alter table users add column if not exists renews_at          timestamptz;

-- 4) Atomic credit deduction: never lets users.credits go negative.
--    Returns the new balance, or NULL if the balance was too low.
create or replace function polaris_deduct_credits(p_user_id uuid, p_cost numeric)
returns numeric language plpgsql security definer as $$
declare
    new_balance numeric;
begin
    update users
       set credits = credits - p_cost
     where id = p_user_id
       and credits >= p_cost
    returning credits into new_balance;
    return new_balance;
end;
$$;
grant execute on function polaris_deduct_credits(uuid, numeric) to anon, authenticated;

-- 3) Append-only usage ledger. One row per (agent, model) LLM call.
--    The backend atomically deducts cost_usd from users.credits on insert.
create table if not exists usage_events (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references users(id) on delete cascade,
    job_uuid      uuid not null,
    agent         text,                                 -- READ|RESEARCH|PLAN|CODE|ORCHESTRATOR|SYSTEM
    model         text,
    input_tokens  int  not null default 0,
    output_tokens int  not null default 0,
    cost_usd      numeric(12,6) not null default 0,
    ts            timestamptz not null default now()
);
create index if not exists usage_user_idx on usage_events(user_id, ts desc);
create index if not exists usage_job_idx  on usage_events(job_uuid, ts);