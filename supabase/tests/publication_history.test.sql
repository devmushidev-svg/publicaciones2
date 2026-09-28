begin;

select plan(10);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('84000000-0000-4000-8000-000000000001', 'history-owner@example.test', '{}'),
  ('84000000-0000-4000-8000-000000000002', 'history-other@example.test', '{}');

insert into public.categories (id, user_id, name)
values ('85000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', 'Tecnología');

insert into public.tags (id, user_id, name)
values ('86000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', 'Temporada');

insert into public.publications (id, user_id, title, body, category_id)
values
  ('87000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', 'Anuncio de prueba', 'Borrador original', '85000000-0000-4000-8000-000000000001'),
  ('87000000-0000-4000-8000-000000000002', '84000000-0000-4000-8000-000000000002', 'Publicación ajena', '', null),
  ('87000000-0000-4000-8000-000000000003', '84000000-0000-4000-8000-000000000001', 'Sin historial', '', null);

insert into public.media_assets (id, user_id, storage_path, file_name, mime_type, byte_size)
values ('88000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001/cover.png', 'cover.png', 'image/png', 128);

insert into public.publication_media (publication_id, media_asset_id, user_id, sort_order)
values ('87000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', 0);

insert into public.publication_tags (publication_id, tag_id, user_id)
values ('87000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', '84000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$select public.record_my_publication_use(
    '87000000-0000-4000-8000-000000000001',
    '89000000-0000-4000-8000-000000000001',
    array['facebook', 'instagram']::text[],
    '2026-09-24 12:00:00+00'::timestamptz,
    'Copy realmente publicado',
    'Primera ocasión'
  )$$,
  'one use can be recorded for multiple platforms'
);

select is(
  (select count(*)::integer from public.publication_history where publication_id = '87000000-0000-4000-8000-000000000001'),
  2,
  'each platform is recorded once'
);

select ok(
  (select bool_and(
    title_snapshot = 'Anuncio de prueba'
    and copy_snapshot = 'Copy realmente publicado'
    and category_snapshot = 'Tecnología'
    and tags_snapshot @> '["Temporada"]'::jsonb
    and media_snapshot -> 0 ->> 'file_name' = 'cover.png'
  ) from public.publication_history where idempotency_key = '89000000-0000-4000-8000-000000000001'),
  'the use keeps immutable text, category, tag, and media snapshots'
);

select lives_ok(
  $$select public.record_my_publication_use(
    '87000000-0000-4000-8000-000000000001',
    '89000000-0000-4000-8000-000000000001',
    array['facebook', 'instagram']::text[],
    '2026-09-24 12:00:00+00'::timestamptz,
    'Copy realmente publicado',
    'Primera ocasión'
  )$$,
  'retrying the same use is safe'
);

select is(
  (select count(*)::integer from public.publication_history where idempotency_key = '89000000-0000-4000-8000-000000000001'),
  2,
  'retry does not create duplicate platform records'
);

select throws_ok(
  $$select public.record_my_publication_use(
    '87000000-0000-4000-8000-000000000001',
    '89000000-0000-4000-8000-000000000001',
    array['facebook']::text[],
    '2026-09-24 12:00:00+00'::timestamptz,
    'Different copy',
    'Primera ocasión'
  )$$,
  '22023',
  null,
  'an idempotency key cannot be reused with changed content'
);

select throws_ok(
  $$select public.record_my_publication_use(
    '87000000-0000-4000-8000-000000000002',
    '89000000-0000-4000-8000-000000000002',
    array['facebook']::text[],
    '2026-09-24 12:00:00+00'::timestamptz,
    '',
    ''
  )$$,
  'P0002',
  null,
  'a user cannot record another account publication'
);

select throws_ok(
  $$update public.publications set status = 'published', published_at = now() where id = '87000000-0000-4000-8000-000000000003'$$,
  '23514',
  null,
  'a publication cannot be marked published without history'
);

select is(
  (select count(*)::integer from public.publication_history),
  2,
  'an account can read its own history'
);

select set_config('request.jwt.claim.sub', '84000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*)::integer from public.publication_history),
  0,
  'another account cannot read the history'
);

select * from finish();
rollback;
