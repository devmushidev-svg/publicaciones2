begin;

select plan(4);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('71000000-0000-4000-8000-000000000001', 'taxonomy-owner@example.test', '{}'),
  ('71000000-0000-4000-8000-000000000002', 'other-taxonomy-owner@example.test', '{}');

insert into public.categories (id, user_id, name)
values ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', 'Privada');
insert into public.tags (id, user_id, name)
values ('73000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000002', 'Privada');
insert into public.publications (id, user_id, title)
values ('74000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'Own publication');

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);

select is((select count(*)::integer from public.categories), 0, 'users cannot read another account categories');
select is((select count(*)::integer from public.tags), 0, 'users cannot read another account tags');
select throws_ok(
  $$insert into public.categories (user_id, name) values ('71000000-0000-4000-8000-000000000002', 'Spoofed')$$,
  '42501', null, 'users cannot create categories for another account'
);
select throws_ok(
  $$insert into public.publication_tags (publication_id, tag_id, user_id) values ('74000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000001')$$,
  '23503', null, 'a user cannot attach another account tag'
);

select * from finish();
rollback;
