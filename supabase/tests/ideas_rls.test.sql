begin;

select plan(3);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('70000000-0000-4000-8000-000000000001', 'idea-owner@example.test', '{}'),
  ('70000000-0000-4000-8000-000000000002', 'other-idea-owner@example.test', '{}');

insert into public.ideas (id, user_id, title, notes)
values ('80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', 'Private idea', 'Only its owner should see this.');

set local role authenticated;
select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000001', true);

select is((select count(*)::integer from public.ideas), 0, 'users cannot read another account ideas');

select throws_ok(
  $$
    insert into public.ideas (user_id, title)
    values ('70000000-0000-4000-8000-000000000002', 'Spoofed idea')
  $$,
  '42501',
  null,
  'users cannot create ideas for another account'
);

select is(
  (with changed as (
    update public.ideas set status = 'archived'
    where id = '80000000-0000-4000-8000-000000000001'
    returning id
  ) select count(*)::integer from changed),
  0,
  'users cannot modify another account ideas'
);

select * from finish();
rollback;
