begin;

select plan(6);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('81000000-0000-4000-8000-000000000001', 'editor-owner@example.test', '{}'),
  ('81000000-0000-4000-8000-000000000002', 'other-editor@example.test', '{}');

insert into public.media_assets (id, user_id, storage_path, file_name, mime_type, byte_size)
values
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001/own.png', 'own.png', 'image/png', 128),
  ('82000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002/other.png', 'other.png', 'image/png', 128);

insert into public.tags (id, user_id, name)
values ('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'Oferta');

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select public.save_my_publication(null, 'Invalid media', '', null, 'draft', null, null, '{}'::text[], array['82000000-0000-4000-8000-000000000002']::uuid[], '{}'::uuid[])$$,
  '23503', null, 'another account media cannot be linked'
);
select is((select count(*)::integer from public.publications), 0, 'failed media link rolls back the publication');

select lives_ok(
  $$select public.save_my_publication(null, 'Own publication', '', null, 'draft', null, null, '{}'::text[], array['82000000-0000-4000-8000-000000000001']::uuid[], array['83000000-0000-4000-8000-000000000001']::uuid[])$$,
  'owned media and tag can be saved together'
);
select is(
  (select count(*)::integer from public.publications p join public.publication_media m on m.publication_id = p.id join public.publication_tags t on t.publication_id = p.id where p.title = 'Own publication'),
  1, 'the saved publication has both links'
);

select lives_ok(
  $$select public.save_my_publication((select id from public.publications where title = 'Own publication'), 'Updated publication', '', null, 'draft', null, null, '{}'::text[], '{}'::uuid[], '{}'::uuid[])$$,
  'editing can replace media and tag links'
);
select is(
  (select count(*)::integer from public.publications p where p.title = 'Updated publication' and not exists (select 1 from public.publication_media where publication_id = p.id) and not exists (select 1 from public.publication_tags where publication_id = p.id)),
  1, 'editing clears removed links together'
);

select * from finish();
rollback;
