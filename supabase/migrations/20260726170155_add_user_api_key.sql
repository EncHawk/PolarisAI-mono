-- Add api_key column to public.users for API key authentication
-- Previous migration (20260726000001) already added credits before api_key was added.
alter table public.users add column if not exists api_key text unique;
