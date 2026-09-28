begin;

select plan(7);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('94000000-0000-4000-8000-000000000001', 'ai-copy-owner@example.test', '{}'),
  ('94000000-0000-4000-8000-000000000002', 'ai-copy-other@example.test', '{}');

create temporary table ai_copy_test_context (generation_id uuid);
grant select, insert on ai_copy_test_context to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);

insert into ai_copy_test_context
select generation_id from public.start_my_ai_copy_generation('A sufficiently detailed message brief', array['instagram'], 'test-model');

select is((select count(*)::integer from public.ai_copy_generations), 1, 'owner can see their own generation');

select lives_ok(
  $$select public.finish_my_ai_copy_generation(
    (select generation_id from ai_copy_test_context), 'succeeded',
    '[{"angle":"Community","headline":"A title","body":"A draft","callToAction":"Learn more"}]'::jsonb,
    null, 20, 40
  )$$,
  'owner can finish their generation'
);

select is((select status from public.ai_copy_generations), 'succeeded', 'generation result is persisted');

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.ai_copy_generations), 0, 'other user cannot read the generation');

select throws_ok(
  $$select public.finish_my_ai_copy_generation(
    (select generation_id from ai_copy_test_context), 'succeeded', '[]'::jsonb, null, 0, 0
  )$$,
  'P0002', 'Generation not found or already finished', 'other user cannot finish the generation'
);

select is((select used from public.start_my_ai_copy_generation('A sufficiently detailed second brief', array['facebook'], 'test-model')), 1, 'quota is isolated per user');

select ok(not has_function_privilege('anon', 'public.start_my_ai_copy_generation(text,text[],text)', 'execute'), 'anonymous users cannot reserve generations');

select * from finish();
rollback;
