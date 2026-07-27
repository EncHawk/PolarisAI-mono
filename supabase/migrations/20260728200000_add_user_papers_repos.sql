-- Add papers list and private_repos list to users table
-- papers: array of paper references the user has worked on
-- private_repos: array of private GitHub repo URLs (pro/premium GPU runs only)

alter table users add column if not exists papers jsonb not null default '[]'::jsonb;
alter table users add column if not exists private_repos jsonb not null default '[]'::jsonb;
