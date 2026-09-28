begin;

select plan(11);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000001', 'profile-owner@example.test', '{"full_name":"Profile Owner"}'),
  ('10000000-0000-4000-8000-000000000002', 'other-owner@example.test', '{"full_name":"Other Owner"}');

select is((select count(*)::integer from public.profiles), 2, 'Auth signup creates one profile per user');
select is(
  (select timezone from public.profiles where id = '10000000-0000-4000-8000-000000000001'),
  'America/Tegucigalpa',
  'new profiles use the business timezone'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'RLS is enabled on profiles'
);
select ok(not has_table_privilege('anon', 'public.profiles', 'select'), 'anonymous users cannot read profiles');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'insert'), 'users cannot insert profiles directly');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'delete'), 'users cannot delete profiles');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'created_at', 'update'), 'users cannot update profile timestamps');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select is((select count(*)::integer from public.profiles), 1, 'users can read only their own profile');
select is(
  (select count(*)::integer from public.profiles where id = '10000000-0000-4000-8000-000000000002'),
  0,
  'users cannot read another profile'
);
update public.profiles set full_name = 'Updated Owner'
where id = '10000000-0000-4000-8000-000000000001';
update public.profiles set full_name = 'Tampered'
where id = '10000000-0000-4000-8000-000000000002';

reset role;
select is(
  (select full_name from public.profiles where id = '10000000-0000-4000-8000-000000000001'),
  'Updated Owner',
  'users can update their own profile'
);
select is(
  (select full_name from public.profiles where id = '10000000-0000-4000-8000-000000000002'),
  'Other Owner',
  'users cannot update another profile'
);

select * from finish();
rollback;
