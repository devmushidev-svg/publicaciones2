begin;

select plan(11);

insert into auth.users(id, email, raw_user_meta_data) values
  ('b1000000-0000-4000-8000-000000000001', 'meta-owner@example.test', '{}'),
  ('b1000000-0000-4000-8000-000000000002', 'meta-other@example.test', '{}');

select ok(not has_table_privilege('authenticated', 'public.social_connections', 'insert'), 'browser cannot forge a connection row');
select ok(not has_table_privilege('authenticated', 'private.social_connection_secrets', 'select'), 'tokens are not readable by clients');
select ok(not has_function_privilege('authenticated', 'public.begin_my_meta_connection(uuid,jsonb,timestamptz)', 'execute'), 'browser callers cannot start a connection');

set local role service_role;
select set_config('test.meta_attempt', public.begin_my_meta_connection('b1000000-0000-4000-8000-000000000001',
  '[{"id":"page-1","name":"La Pagina","access_token":"secret-page-token","instagram_business_account":{"id":"ig-1","username":"norte"}}]'::jsonb,
  now() + interval '30 days')::text, true);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
select is(jsonb_array_length(public.list_my_meta_connection_pages(current_setting('test.meta_attempt')::uuid)), 1, 'owner sees available Pages');
select ok(public.list_my_meta_connection_pages(current_setting('test.meta_attempt')::uuid)::text not like '%secret-page-token%', 'Page listing never exposes a token');
select throws_ok($$insert into public.social_connections(user_id,provider,account_name) values ('b1000000-0000-4000-8000-000000000001','facebook','Falsa')$$,
  '42501', null, 'direct connection writes are denied');

select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000002', true);
select is(public.list_my_meta_connection_pages(current_setting('test.meta_attempt')::uuid), '[]'::jsonb, 'another user cannot see pending Pages');
select throws_ok(format('select public.finish_my_meta_connection(%L::uuid, %L, true)', current_setting('test.meta_attempt'), 'page-1'),
  'P0002', null, 'another user cannot complete the attempt');

select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
select lives_ok(format('select public.finish_my_meta_connection(%L::uuid, %L, true)', current_setting('test.meta_attempt'), 'page-1'),
  'owner connects Facebook and linked Instagram');
select is((select count(*)::integer from public.social_connections where user_id = auth.uid()), 2, 'both provider rows exist');
select lives_ok($$select public.disconnect_my_meta_connection('facebook')$$, 'disconnecting Facebook also disconnects linked Instagram');

rollback;
