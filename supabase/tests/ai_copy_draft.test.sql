begin;

select plan(7);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('c1000000-0000-4000-8000-000000000001', 'ai-draft-owner@example.test', '{}'),
  ('c1000000-0000-4000-8000-000000000002', 'ai-draft-other@example.test', '{}');

insert into public.ai_copy_generations (id, user_id, brief, platforms, status, model, completed_at, created_at)
values
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Brief suficientemente largo', array['instagram', 'whatsapp'], 'succeeded', 'test', now(), now()),
  ('c2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 'Brief que quedó colgado', array['instagram'], 'generating', 'test', null, now() - interval '1 hour'),
  ('c2000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001', 'Brief que falló a medias', array['instagram'], 'failed', 'test', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);

select is(
  public.save_my_ai_copy_draft('c2000000-0000-4000-8000-000000000001', 'Título', 'Texto revisado'),
  public.save_my_ai_copy_draft('c2000000-0000-4000-8000-000000000001', 'Título', 'Texto revisado'),
  'saving the same generation twice returns the same draft'
);
select is(
  (select count(*)::integer || ':' || min(status::text) || ':' || array_to_string(min(platforms), ',') from public.publications),
  '1:draft:instagram',
  'one draft is created with only supported publication platforms'
);
select throws_ok(
  $$select public.save_my_ai_copy_draft('c2000000-0000-4000-8000-000000000003', 'Título', 'Texto')$$,
  'P0002', null, 'failed generations cannot be saved'
);
select lives_ok(
  $$select * from public.start_my_ai_copy_generation('Un brief nuevo y detallado', array['instagram','facebook','linkedin','tiktok','x','whatsapp'], 'test')$$,
  'all six offered platforms are accepted'
);
select is(
  (select status || ':' || failure_code from public.ai_copy_generations where id = 'c2000000-0000-4000-8000-000000000002'),
  'failed:abandoned',
  'stale generating attempts are closed on the next reservation'
);

select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.save_my_ai_copy_draft('c2000000-0000-4000-8000-000000000001', 'Robado', 'Texto')$$,
  'P0002', null, 'another account cannot save the generation'
);
reset role;
select ok(not has_function_privilege('anon', 'public.save_my_ai_copy_draft(uuid,text,text)', 'execute'), 'anonymous users cannot save drafts');

select * from finish();
rollback;
