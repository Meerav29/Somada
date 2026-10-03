-- EMERGENCY USE ONLY. Restores the old app's behavior for the legacy row only.
-- The recreated policies are scoped to the legacy row (user_id is null and not is_demo,
-- i.e. id = 1, the only row the old app reads and upserts). Per-user rows and the demo row
-- stay private/protected. Columns and constraints are kept; re-run 0002 to go back (it is idempotent).
begin;
alter table public.health_data alter column id set default 1;
drop policy if exists "own_row_select" on public.health_data;
drop policy if exists "demo_row_select" on public.health_data;
drop policy if exists "own_row_insert" on public.health_data;
drop policy if exists "own_row_update" on public.health_data;
drop policy if exists "own_row_delete" on public.health_data;
drop policy if exists "allow_public_read" on public.health_data;
drop policy if exists "allow_auth_write" on public.health_data;
create policy "allow_public_read" on public.health_data
  for select using (user_id is null and not is_demo);
create policy "allow_auth_write" on public.health_data
  for all to authenticated
  using (user_id is null and not is_demo)
  with check (user_id is null and not is_demo);
commit;
