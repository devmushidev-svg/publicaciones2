begin;

select plan(26);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('a1000000-0000-4000-8000-000000000001', 'schedule-owner@example.test', '{}'),
  ('a1000000-0000-4000-8000-000000000002', 'schedule-other@example.test', '{}');

insert into public.publications (id, user_id, title, body)
values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Promo semanal', 'Texto'),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'Ajena', ''),
  ('a2000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'Para archivar', '');

-- The owner works in Tegucigalpa (UTC-6). 05:30 UTC on day D+2 is still day D+1 locally.
create temporary table schedule_ctx as
select
  (now() at time zone 'America/Tegucigalpa')::date as today,
  ((now() at time zone 'America/Tegucigalpa')::date + 1)::timestamp at time zone 'America/Tegucigalpa' + interval '23 hours 30 minutes' as late_day1,
  ((now() at time zone 'America/Tegucigalpa')::date + 2)::timestamp at time zone 'America/Tegucigalpa' + interval '10 hours' as day2,
  ((now() at time zone 'America/Tegucigalpa')::date + 20)::timestamp at time zone 'America/Tegucigalpa' + interval '10 hours' as day20;
grant select on schedule_ctx to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$select public.save_my_campaign(null, 'Temporada', 'Objetivo', '#336699', (select today + 1 from schedule_ctx), (select today + 5 from schedule_ctx), 6)$$,
  'owner creates a campaign'
);
select throws_ok(
  $$select public.save_my_campaign(null, 'Invertida', '', '#336699', (select today + 5 from schedule_ctx), (select today + 1 from schedule_ctx), null)$$,
  '22023', null, 'campaign end date cannot precede the start'
);
select throws_ok(
  $$insert into public.campaigns (user_id, name, starts_on, ends_on) values ('a1000000-0000-4000-8000-000000000001', 'Directa', current_date, current_date)$$,
  '42501', null, 'campaigns cannot be written directly'
);

select lives_ok(
  $$select public.schedule_my_publication('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001',
    (select late_day1 from schedule_ctx), array['instagram', 'facebook', 'instagram'], (select id from public.campaigns), 'Primera')$$,
  'owner schedules a publication inside the campaign in local time'
);
select is(
  (select platforms from public.scheduled_posts where id = 'a3000000-0000-4000-8000-000000000001'),
  array['facebook', 'instagram']::text[],
  'platforms are deduplicated'
);
select lives_ok(
  $$select public.schedule_my_publication('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001',
    (select late_day1 from schedule_ctx), array['facebook', 'instagram'], (select id from public.campaigns), 'Primera')$$,
  'retrying the same schedule request is safe'
);
select is((select count(*)::integer from public.scheduled_posts), 1, 'retry does not duplicate the slot');
select throws_ok(
  $$select public.schedule_my_publication('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001',
    (select day2 from schedule_ctx), array['facebook'], null, '')$$,
  '22023', null, 'a schedule request id cannot be reused with different data'
);
select throws_ok(
  $$select public.schedule_my_publication('a3000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001',
    (select late_day1 from schedule_ctx) - interval '8 hours', array['facebook'], null, '')$$,
  '23505', null, 'the same publication cannot be planned twice on the same local day'
);
select throws_ok(
  $$select public.schedule_my_publication('a3000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000001',
    (select day20 from schedule_ctx), array['facebook'], (select id from public.campaigns), '')$$,
  '22023', null, 'a slot cannot fall outside its campaign dates'
);
select throws_ok(
  $$select public.schedule_my_publication('a3000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000001',
    now() - interval '1 day', array['facebook'], null, '')$$,
  '22023', null, 'new intentions must be in the future'
);
select throws_ok(
  $$select public.schedule_my_publication('a3000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000002',
    (select day2 from schedule_ctx), array['facebook'], null, '')$$,
  'P0002', null, 'a user cannot schedule another account publication'
);

select lives_ok(
  $$select public.reschedule_my_post('a3000000-0000-4000-8000-000000000001', (select day2 from schedule_ctx), (select id from public.campaigns))$$,
  'owner moves a planned slot'
);
select throws_ok(
  $$select public.save_my_campaign((select id from public.campaigns), 'Temporada', '', '#336699', (select today + 3 from schedule_ctx), (select today + 5 from schedule_ctx), null)$$,
  '22023', null, 'campaign dates cannot exclude planned slots'
);

select is(
  (select status from public.scheduled_posts where id = 'a3000000-0000-4000-8000-000000000001'),
  'planned',
  'a slot stays planned until its use is recorded'
);
select is((select count(*)::integer from public.publication_history), 0, 'scheduling never writes history');

select lives_ok(
  $$select public.record_my_scheduled_post_use('a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
    array['facebook'], now() - interval '1 hour', 'Copy real', '')$$,
  'recording a planned slot writes history'
);
select lives_ok(
  $$select public.record_my_scheduled_post_use('a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
    array['facebook'], now() - interval '1 hour', 'Copy real', '')$$,
  'retrying the recorded use is safe'
);
select is(
  (select count(*)::integer from public.publication_history where idempotency_key = 'a4000000-0000-4000-8000-000000000001'),
  1,
  'history has one row per platform after retries'
);
select is(
  (select status || ':' || history_idempotency_key::text from public.scheduled_posts where id = 'a3000000-0000-4000-8000-000000000001'),
  'fulfilled:a4000000-0000-4000-8000-000000000001',
  'the slot links to the history occasion'
);
select throws_ok(
  $$select public.cancel_my_scheduled_post('a3000000-0000-4000-8000-000000000001')$$,
  '55000', null, 'a fulfilled slot cannot be cancelled'
);

select public.schedule_my_publication('a3000000-0000-4000-8000-000000000006', 'a2000000-0000-4000-8000-000000000003',
  (select day2 from schedule_ctx), '{}', null, '');
update public.publications set status = 'archived' where id = 'a2000000-0000-4000-8000-000000000003';
select is(
  (select status from public.scheduled_posts where id = 'a3000000-0000-4000-8000-000000000006'),
  'cancelled',
  'archiving a publication cancels its planned slots'
);

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.scheduled_posts), 0, 'another account cannot read slots');
select is((select count(*)::integer from public.campaigns), 0, 'another account cannot read campaigns');
select throws_ok(
  $$select public.cancel_my_scheduled_post('a3000000-0000-4000-8000-000000000006')$$,
  'P0002', null, 'another account cannot cancel a slot'
);

reset role;
select ok(
  not has_function_privilege('anon', 'public.schedule_my_publication(uuid,uuid,timestamptz,text[],uuid,text)', 'execute')
  and not has_table_privilege('anon', 'public.scheduled_posts', 'select'),
  'anonymous users cannot schedule or read slots'
);

select * from finish();
rollback;
