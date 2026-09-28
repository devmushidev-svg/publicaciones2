-- Read-only check of phases 5-9 on a Supabase project. Paste it in the SQL Editor.
-- It changes nothing. Compare "objetos_presentes" (the schema) with "registrada" (the
-- migration history): a schema can be partially present without its version recorded.

with expected(version, migration, probe_ok) as (
  values
    ('20260925000700', 'publication_history',
      to_regclass('public.publication_history') is not null
      and to_regprocedure('public.record_my_publication_use(uuid,uuid,text[],timestamptz,text,text)') is not null
      and exists (select 1 from pg_trigger where tgname = 'publications_require_history_before_published')),
    ('20260925000800', 'recommendations',
      to_regclass('public.recommendation_settings') is not null
      and to_regclass('public.category_preferences') is not null
      and to_regprocedure('public.save_my_recommendation_settings(smallint,smallint,smallint,jsonb)') is not null),
    ('20260928000100', 'ai_copy_generation',
      to_regclass('public.ai_copy_generations') is not null
      and to_regprocedure('public.start_my_ai_copy_generation(text,text[],text)') is not null
      and to_regprocedure('public.finish_my_ai_copy_generation(uuid,text,jsonb,text,integer,integer)') is not null
      and to_regprocedure('public.mark_my_ai_copy_saved(uuid,uuid)') is not null),
    ('20260928000200', 'ai_copy_draft',
      to_regprocedure('public.save_my_ai_copy_draft(uuid,text,text)') is not null),
    ('20260928000300', 'schedule_and_campaigns',
      to_regclass('public.scheduled_posts') is not null
      and to_regclass('public.campaigns') is not null
      and to_regprocedure('public.schedule_my_publication(uuid,uuid,timestamptz,text[],uuid,text)') is not null
      and to_regprocedure('public.record_my_scheduled_post_use(uuid,uuid,text[],timestamptz,text,text)') is not null),
    ('20260928000400', 'ideas_opportunities',
      to_regprocedure('public.convert_my_idea_to_draft(uuid)') is not null
      and to_regprocedure('public.save_my_opportunity_idea(text,text,text,uuid)') is not null
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ideas' and column_name = 'source_key'))
)
select
  e.version,
  e.migration,
  e.probe_ok as objetos_presentes,
  exists (select 1 from supabase_migrations.schema_migrations m where m.version = e.version) as registrada
from expected e
order by e.version;

-- RLS and anonymous access on the tables these phases use. Every row should show
-- rls_activo = true and anon_puede_leer = false.
select
  c.relname as tabla,
  c.relrowsecurity as rls_activo,
  has_table_privilege('anon', c.oid, 'select') as anon_puede_leer,
  has_table_privilege('authenticated', c.oid, 'insert') as authenticated_inserta_directo
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where c.relname in ('publication_history', 'recommendation_settings', 'category_preferences', 'ai_copy_generations', 'scheduled_posts', 'campaigns', 'ideas')
order by c.relname;

-- Legacy schedules that 20260928000300 will move into scheduled_posts (0 after applying it).
select count(*) as publicaciones_con_estado_programada
from public.publications
where status = 'scheduled';
