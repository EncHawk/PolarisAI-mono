-- Add credits and api_key columns to users table
-- Application code assumes these exist for credit-based features and API key auth
alter table users add column if not exists credits int not null default 3;
alter table users add column if not exists api_key text unique;
