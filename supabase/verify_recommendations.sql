select
  required.object_name as objeto,
  to_regclass(required.relation_name) is not null as existe,
  coalesce(
    (
      select relation.relrowsecurity
      from pg_catalog.pg_class as relation
      where relation.oid = to_regclass(required.relation_name)
    ),
    false
  ) as rls_activo
from (values
  ('categories', 'public.categories'),
  ('recommendation_settings', 'public.recommendation_settings'),
  ('category_preferences', 'public.category_preferences')
) as required(object_name, relation_name)

union all

select
  'save_my_recommendation_settings' as objeto,
  to_regprocedure('public.save_my_recommendation_settings(smallint,smallint,smallint,jsonb)') is not null as existe,
  null::boolean as rls_activo

order by objeto;
