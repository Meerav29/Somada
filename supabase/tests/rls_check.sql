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

  update public.health_data set data = '{"who":"hacked"}' where data->>'who' = 'b';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user A updated user B row'; end if;

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

reset role;
set local role anon;
do $$
declare n int;
begin
  begin
    select count(*) into n from public.health_data;
    if n <> 0 then raise exception 'FAIL: anon can read % rows', n; end if;
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
select 'ALL RLS CHECKS PASSED' as result;
