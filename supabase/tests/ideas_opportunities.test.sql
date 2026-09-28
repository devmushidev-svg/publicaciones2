begin;

select plan(11);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('b1000000-0000-4000-8000-000000000001', 'ideas-owner@example.test', '{}'),
  ('b1000000-0000-4000-8000-000000000002', 'ideas-other@example.test', '{}');

insert into public.ideas (id, user_id, title, notes)
values
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Idea propia', 'Notas'),
  ('b2000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', 'Idea ajena', '');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);

create temporary table idea_ctx (publication_id uuid);
select lives_ok(
  $$insert into idea_ctx select public.convert_my_idea_to_draft('b2000000-0000-4000-8000-000000000001')$$,
  'owner converts an idea into a draft'
);
select is(
  (select status::text || ':' || (publication_id = (select publication_id from idea_ctx))::text from public.ideas where id = 'b2000000-0000-4000-8000-000000000001'),
  'used:true',
  'the idea is marked used and linked to its draft'
);
select is(
  public.convert_my_idea_to_draft('b2000000-0000-4000-8000-000000000001'),
  (select publication_id from idea_ctx),
  'retrying the conversion returns the same draft'
);
select is((select count(*)::integer from public.publications), 1, 'retry does not create a second draft');
select throws_ok(
  $$select public.convert_my_idea_to_draft('b2000000-0000-4000-8000-000000000002')$$,
  'P0002', null, 'another account idea cannot be converted'
);
select throws_ok(
  $$update public.ideas set publication_id = null where id = 'b2000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'link columns cannot be edited directly'
);

select is(
  public.save_my_opportunity_idea('category-gap:abc', 'Retomar Comunidad', 'Sin usos en 14 días', null),
  public.save_my_opportunity_idea('category-gap:abc', 'Retomar Comunidad', 'Sin usos en 14 días', null),
  'saving the same opportunity twice returns one idea'
);
select is((select count(*)::integer from public.ideas where source_key = 'category-gap:abc'), 1, 'opportunity ideas are deduplicated');
select lives_ok(
  $$insert into public.ideas (user_id, title) values ('b1000000-0000-4000-8000-000000000001', 'Idea directa')$$,
  'owners can still create ideas directly'
);

select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.ideas), 1, 'another account only sees its own ideas');

reset role;
select ok(
  not has_function_privilege('anon', 'public.convert_my_idea_to_draft(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.save_my_opportunity_idea(text,text,text,uuid)', 'execute'),
  'anonymous users cannot use idea functions'
);

select * from finish();
rollback;
