begin;

select plan(2);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('20000000-0000-4000-8000-000000000001', 'metric-owner@example.test', '{}'),
  ('20000000-0000-4000-8000-000000000002', 'other-metric-owner@example.test', '{}');

insert into public.publications (id, user_id, title)
values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Owner publication'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Other publication');

select lives_ok(
  $$
    insert into public.performance_metrics (user_id, publication_id, platform, measured_on)
    values (
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'instagram',
      current_date
    )
  $$,
  'a user can attach metrics to their own publication'
);

select throws_ok(
  $$
    insert into public.performance_metrics (user_id, publication_id, platform, measured_on)
    values (
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      'instagram',
      current_date
    )
  $$,
  '23503',
  null,
  'a user cannot attach metrics to another user publication'
);

select * from finish();
rollback;
