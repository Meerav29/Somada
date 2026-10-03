-- Run in the SQL editor of the SCRATCH project after applying 0001 and 0002.
-- Everything happens in one transaction that is rolled back. A failed assertion
-- raises an exception; success prints ALL RLS CHECKS PASSED at the end.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'b@test.local'),
  ('00000000-0000-0000-0000-0000000000c3', 'c@test.local');

insert into public.health_data (user_id, data) values
  ('00000000-0000-0000-0000-0000000000a1', '{"who":"a"}'),
  ('00000000-0000-0000-0000-0000000000b2', '{"who":"b"}');
insert into public.health_data (is_demo, data) values (true, '{"who":"demo"}');
-- Legacy shared row: no owner, not demo. Must be invisible to every non-superuser role.
insert into public.health_data (id, data) values (1, '{"who":"legacy"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

do $$
declare n int;
begin
  select count(*) into n from public.health_data where data->>'who' = 'b';
  if n <> 0 then raise exception 'FAIL: user A can read user B row'; end if;

  select count(*) into n from public.health_data where data->>'who' = 'a';
  if n <> 1 then raise exception 'FAIL: user A cannot read own row'; end if;

  select count(*) into n from public.health_data where is_demo;
  if n <> 1 then raise exception 'FAIL: user A cannot read demo row'; end if;

  select count(*) into n from public.health_data where data->>'who' = 'legacy';
  if n <> 0 then raise exception 'FAIL: user A can read the legacy row'; end if;

  -- Positive: A can update their own row (proves RLS, not missing grants, is what blocks below).
  update public.health_data set data = '{"who":"a","v":2}' where data->>'who' = 'a';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: user A cannot update own row'; end if;

  update public.health_data set data = '{"who":"hacked"}' where data->>'who' = 'b';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user A updated user B row'; end if;

  update public.health_data set data = '{"who":"hacked"}' where data->>'who' = 'legacy';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user A updated the legacy row'; end if;

  update public.health_data set data = '{"who":"hacked"}' where is_demo;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user A updated the demo row'; end if;

  begin
    insert into public.health_data (user_id, data)
    values ('00000000-0000-0000-0000-0000000000c3', '{}');
    raise exception 'FAIL: user A inserted a row for user C';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.health_data (is_demo, data) values (true, '{}');
    raise exception 'FAIL: user A inserted a demo row';
  exception when insufficient_privilege or unique_violation then null;
  end;
end $$;

-- Positive: a user with no row yet (C) can insert their own row and read it back.
-- Runs after the "A inserts a row for C" negative above, while C still had no row.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c3', true);
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', true);

do $$
declare n int;
begin
  insert into public.health_data (user_id, data)
  values ('00000000-0000-0000-0000-0000000000c3', '{"who":"c"}');

  select count(*) into n from public.health_data where data->>'who' = 'c';
  if n <> 1 then raise exception 'FAIL: user C cannot read own newly inserted row'; end if;

  select count(*) into n from public.health_data where data->>'who' in ('a', 'b', 'legacy');
  if n <> 0 then raise exception 'FAIL: user C can read other rows'; end if;
end $$;

reset role;
set local role anon;
do $$
declare n int;
begin
  begin
    select count(*) into n from public.health_data;
    if n <> 0 then raise exception 'FAIL: anon can read % rows', n; end if;

    update public.health_data set data = '{"who":"hacked"}' where data->>'who' = 'legacy';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL: anon updated the legacy row'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
select 'ALL RLS CHECKS PASSED' as result;
