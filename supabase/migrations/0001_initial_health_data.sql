-- FRESH INSTALLS ONLY. Existing deployments already have this table; skip to 0002.
create table if not exists public.health_data (
  id integer primary key default 1,
  data jsonb not null,
  updated_at timestamptz default now()
);
alter table public.health_data enable row level security;
