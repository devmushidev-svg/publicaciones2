begin;

select plan(3);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('90000000-0000-4000-8000-000000000001', 'settings-owner@example.test', '{}'),
  ('90000000-0000-4000-8000-000000000002', 'other-settings-owner@example.test', '{}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$ select public.update_my_settings('Settings Owner', 'America/New_York', 0, false) $$,
  'an authenticated user can update their own settings'
);

select is(
  (select count(*)::integer
   from public.profiles p
   join public.account_preferences a on a.user_id = p.id
   where p.id = '90000000-0000-4000-8000-000000000001'
     and p.full_name = 'Settings Owner'
     and p.timezone = 'America/New_York'
     and a.timezone = 'America/New_York'
     and a.week_starts_on = 0
     and a.email_digest = false),
  1,
  'profile and preferences update together for the current account'
);

reset role;
select is(
  (select count(*)::integer
   from public.profiles p
   join public.account_preferences a on a.user_id = p.id
   where p.id = '90000000-0000-4000-8000-000000000002'
     and p.timezone = 'America/Tegucigalpa'
     and a.timezone = 'America/Tegucigalpa'
     and a.week_starts_on = 1
     and a.email_digest = true),
  1,
  'another account settings remain untouched'
);

select * from finish();
rollback;
