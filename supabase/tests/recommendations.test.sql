begin;

select plan(7);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('94000000-0000-4000-8000-000000000001', 'recommend-owner@example.test', '{}'),
  ('94000000-0000-4000-8000-000000000002', 'recommend-other@example.test', '{}');

insert into public.categories (id, user_id, name)
values
  ('95000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 'Comunidad'),
  ('95000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000002', 'Privada');

insert into public.recommendation_settings (user_id)
values ('94000000-0000-4000-8000-000000000001'), ('94000000-0000-4000-8000-000000000002');

insert into public.category_preferences (user_id, category_id, target_share, priority)
values
  ('94000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', 0.5000, 4),
  ('94000000-0000-4000-8000-000000000002', '95000000-0000-4000-8000-000000000002', 0.5000, 4);

set local role authenticated;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);

select is((select count(*)::integer from public.recommendation_settings), 1, 'users can read only their own recommendation settings');
select is((select count(*)::integer from public.category_preferences), 1, 'users can read only their own category preferences');
select lives_ok(
  $$insert into public.category_preferences (user_id, category_id, priority) values ('94000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', 5) on conflict (user_id, category_id) do update set priority = excluded.priority$$,
  'users can update their own category preferences'
);
select lives_ok(
  $$select public.save_my_recommendation_settings(4::smallint, 21::smallint, 30::smallint, '[{"category_id":"95000000-0000-4000-8000-000000000001","target_share":0.25,"priority":5,"is_enabled":true}]'::jsonb)$$,
  'the recommendation settings are saved through the owner-scoped function'
);
select is((select posts_per_day::integer from public.recommendation_settings where user_id = '94000000-0000-4000-8000-000000000001'), 4, 'the settings update is committed for the authenticated owner');
select throws_ok(
  $$insert into public.category_preferences (user_id, category_id, priority) values ('94000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000002', 5)$$,
  '23503', null, 'a category preference cannot cross account ownership'
);
select throws_ok(
  $$insert into public.recommendation_settings (user_id, posts_per_day) values ('94000000-0000-4000-8000-000000000002', 4)$$,
  '42501', null, 'users cannot write recommendation settings for another account'
);

select * from finish();
rollback;
