do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.publications'::regclass
      and contype in ('u', 'p')
      and conkey = array[
        (select attnum from pg_catalog.pg_attribute where attrelid = 'public.publications'::regclass and attname = 'id'),
        (select attnum from pg_catalog.pg_attribute where attrelid = 'public.publications'::regclass and attname = 'user_id')
      ]::smallint[]
  ) then
    alter table public.publications
      add constraint publications_id_user_id_key unique (id, user_id);
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.performance_metrics'::regclass
      and contype = 'f'
      and confrelid = 'public.publications'::regclass
      and conkey = array[
        (select attnum from pg_catalog.pg_attribute where attrelid = 'public.performance_metrics'::regclass and attname = 'publication_id'),
        (select attnum from pg_catalog.pg_attribute where attrelid = 'public.performance_metrics'::regclass and attname = 'user_id')
      ]::smallint[]
      and confkey = array[
        (select attnum from pg_catalog.pg_attribute where attrelid = 'public.publications'::regclass and attname = 'id'),
        (select attnum from pg_catalog.pg_attribute where attrelid = 'public.publications'::regclass and attname = 'user_id')
      ]::smallint[]
  ) then
    alter table public.performance_metrics
      add constraint performance_metrics_publication_owner_fkey
      foreign key (publication_id, user_id)
      references public.publications (id, user_id)
      on delete cascade;
  end if;
end;
$$;
