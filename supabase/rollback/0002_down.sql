-- EMERGENCY USE ONLY. Restores the old shared, publicly readable behavior.
-- WARNING: re-creating allow_public_read exposes EVERY per-user row (not just id = 1)
-- to anon. Only run this if you accept all stored health data being publicly readable.
-- Columns are kept; the legacy row (id = 1) is still intact, so the old app works again.
begin;
alter table public.health_data alter column id set default 1;
drop policy if exists "own_row_select" on public.health_data;
drop policy if exists "demo_row_select" on public.health_data;
drop policy if exists "own_row_insert" on public.health_data;
drop policy if exists "own_row_update" on public.health_data;
drop policy if exists "own_row_delete" on public.health_data;
create policy "allow_public_read" on public.health_data for select using (true);
create policy "allow_auth_write" on public.health_data
  for all using (auth.role() = 'authenticated');
commit;
