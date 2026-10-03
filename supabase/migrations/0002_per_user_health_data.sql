-- Per-user health data with row-level security.
-- Safe to run once on the live database. The legacy shared row (id = 1) is left in
-- place but becomes invisible to every role (user_id null, is_demo false), so it can
-- be assigned to its owner later or used for rollback.
begin;

-- id stays the primary key but stops defaulting to 1.
create sequence if not exists public.health_data_id_seq owned by public.health_data.id;
select setval('public.health_data_id_seq',
              greatest((select coalesce(max(id), 1) from public.health_data), 1));
alter table public.health_data
  alter column id set default nextval('public.health_data_id_seq');

alter table public.health_data
  add column user_id uuid references auth.users (id) on delete cascade,
  add column is_demo boolean not null default false;

-- Plain unique constraint (NULLs are distinct) so PostgREST on_conflict=user_id works.
alter table public.health_data
  add constraint health_data_user_id_key unique (user_id);
-- At most one demo row.
create unique index health_data_single_demo on public.health_data (is_demo) where is_demo;
-- A demo row has no owner.
alter table public.health_data
  add constraint health_data_demo_has_no_owner check (not is_demo or user_id is null);

drop policy if exists "allow_public_read" on public.health_data;
drop policy if exists "allow_auth_write" on public.health_data;

create policy "own_row_select" on public.health_data
  for select to authenticated using (user_id = (select auth.uid()));
create policy "demo_row_select" on public.health_data
  for select to authenticated using (is_demo);
create policy "own_row_insert" on public.health_data
  for insert to authenticated
  with check (user_id = (select auth.uid()) and not is_demo);
create policy "own_row_update" on public.health_data
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and not is_demo);
create policy "own_row_delete" on public.health_data
  for delete to authenticated using (user_id = (select auth.uid()));

commit;
