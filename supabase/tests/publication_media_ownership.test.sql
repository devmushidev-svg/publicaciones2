begin;

select plan(4);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('40000000-0000-4000-8000-000000000001', 'media-owner@example.test', '{}'),
  ('40000000-0000-4000-8000-000000000002', 'other-media-owner@example.test', '{}');

insert into public.publications (id, user_id, title)
values
  ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Owner publication'),
  ('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'Other publication');

insert into public.media_assets (id, user_id, storage_path, file_name, mime_type, byte_size)
values
  ('60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001/owner.png', 'owner.png', 'image/png', 128),
  ('60000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002/other.png', 'other.png', 'image/png', 128);

select lives_ok(
  $$
    insert into public.publication_media (publication_id, media_asset_id, user_id)
    values ('50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001')
  $$,
  'a user can link their own media to their own publication'
);

select throws_ok(
  $$
    insert into public.publication_media (publication_id, media_asset_id, user_id)
    values ('50000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001')
  $$,
  '23503',
  null,
  'a user cannot link media to another user publication'
);

select throws_ok(
  $$
    insert into public.publication_media (publication_id, media_asset_id, user_id)
    values ('50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001')
  $$,
  '23503',
  null,
  'a user cannot link another user media to their publication'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*)::integer from public.publication_media),
  1,
  'users can read only their own publication media links'
);

select * from finish();
rollback;
