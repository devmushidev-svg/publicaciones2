-- norte. — Fases 5 a 9 en un solo script para el SQL Editor de Supabase.
--
-- Contiene, en orden, las migraciones:
--   20260925000700_publication_history, 20260925000800_recommendations,
--   20260928000100_ai_copy_generation, 20260928000200_ai_copy_draft,
--   20260928000300_schedule_and_campaigns, 20260928000400_ideas_opportunities
--
-- Es idempotente: si una parte ya existe (por ejemplo, el historial que ya se aplicó),
-- se conserva y el script continúa. Todo corre en una sola transacción: si algo falla,
-- no queda nada a medias. No borra datos.

begin;

-- Requisitos: fases 1-4 (categorías, etiquetas y editor de publicaciones).
do $preflight$
begin
  if to_regclass('public.categories') is null
     or to_regclass('public.publication_tags') is null
     or to_regclass('public.publication_media') is null
     or to_regprocedure('public.save_my_publication(uuid,text,text,uuid,public.publication_status,timestamptz,timestamptz,text[],uuid[],uuid[])') is null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'publications' and column_name = 'media_ids') then
    raise exception 'Faltan las migraciones 20260925000500 y 20260925000600 (categorías y editor de publicaciones). Aplícalas antes de este script.';
  end if;
end
$preflight$;

-- ===================== 20260925000700_publication_history =====================

create table if not exists public.publication_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  publication_id uuid not null,
  idempotency_key uuid not null,
  platform text not null check (platform in ('instagram', 'facebook', 'linkedin', 'tiktok', 'x')),
  published_at timestamptz not null,
  title_snapshot text not null,
  copy_snapshot text not null default '',
  category_snapshot text,
  tags_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(tags_snapshot) = 'array'),
  media_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(media_snapshot) = 'array'),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key, platform),
  foreign key (publication_id, user_id)
    references public.publications(id, user_id)
    on delete restrict
);

create index if not exists publication_history_user_date_idx
  on public.publication_history(user_id, published_at desc, id desc);
create index if not exists publication_history_publication_date_idx
  on public.publication_history(user_id, publication_id, published_at desc);
create index if not exists publication_history_platform_date_idx
  on public.publication_history(user_id, platform, published_at desc);

alter table public.publication_history enable row level security;
revoke all on table public.publication_history from public, anon, authenticated;
grant select on table public.publication_history to authenticated;
drop policy if exists publication_history_select_own on public.publication_history;
create policy publication_history_select_own
  on public.publication_history for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function private.require_publication_history_for_published()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'published' then
    if tg_op = 'INSERT' and not exists (
       select 1
       from public.publication_history h
       where h.publication_id = new.id
         and h.user_id = new.user_id
    ) then
      raise exception 'Record publication use before marking it published' using errcode = '23514';
    elsif tg_op = 'UPDATE' and old.status is distinct from 'published' and not exists (
      select 1
      from public.publication_history h
      where h.publication_id = new.id
        and h.user_id = new.user_id
    ) then
      raise exception 'Record publication use before marking it published' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.require_publication_history_for_published() from public, anon, authenticated;
drop trigger if exists publications_require_history_before_published on public.publications;
create trigger publications_require_history_before_published
  before insert or update of status on public.publications
  for each row execute function private.require_publication_history_for_published();

create or replace function public.record_my_publication_use(
  p_publication_id uuid,
  p_idempotency_key uuid,
  p_platforms text[],
  p_published_at timestamptz,
  p_copy text,
  p_notes text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_publication public.publications%rowtype;
  v_existing public.publication_history%rowtype;
  v_category text;
  v_tags jsonb;
  v_media jsonb;
  v_platform_count integer;
  v_inserted integer;
  v_copy text := coalesce(p_copy, '');
  v_notes text := coalesce(p_notes, '');
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_publication_id is null or p_idempotency_key is null or p_published_at is null then
    raise exception 'Publication, idempotency key, and date are required' using errcode = '22023';
  end if;
  if p_published_at > now() + interval '5 minutes' then
    raise exception 'Publication date cannot be in the future' using errcode = '22023';
  end if;
  if char_length(v_notes) > 2000 then
    raise exception 'Notes cannot exceed 2000 characters' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_platforms, '{}'::text[])) as selected(platform)
    where platform is null or platform not in ('instagram', 'facebook', 'linkedin', 'tiktok', 'x')
  ) then
    raise exception 'Unsupported platform' using errcode = '22023';
  end if;
  select count(distinct selected.platform)::integer into v_platform_count
  from unnest(coalesce(p_platforms, '{}'::text[])) as selected(platform);
  if v_platform_count not between 1 and 5 then
    raise exception 'Select between one and five platforms' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || p_idempotency_key::text, 0)
  );

  select p.* into v_publication
  from public.publications p
  where p.id = p_publication_id and p.user_id = v_user_id
  for update;
  if not found or v_publication.status = 'archived' then
    raise exception 'Publication not found or archived' using errcode = 'P0002';
  end if;

  select * into v_existing
  from public.publication_history
  where user_id = v_user_id and idempotency_key = p_idempotency_key
  order by created_at, platform
  limit 1;

  if found then
    if v_existing.publication_id <> p_publication_id
       or v_existing.published_at <> p_published_at
       or v_existing.copy_snapshot <> v_copy
       or v_existing.notes <> v_notes then
      raise exception 'Idempotency key was reused with different publication data' using errcode = '22023';
    end if;
    v_publication.title := v_existing.title_snapshot;
    v_category := v_existing.category_snapshot;
    v_tags := v_existing.tags_snapshot;
    v_media := v_existing.media_snapshot;
  else
    select c.name into v_category
    from public.categories c
    where c.id = v_publication.category_id and c.user_id = v_user_id;

    select coalesce(jsonb_agg(t.name order by lower(t.name), t.id), '[]'::jsonb)
      into v_tags
    from public.publication_tags pt
    join public.tags t on t.id = pt.tag_id and t.user_id = pt.user_id
    where pt.publication_id = p_publication_id and pt.user_id = v_user_id;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'storage_path', a.storage_path,
          'file_name', a.file_name,
          'mime_type', a.mime_type,
          'alt_text', a.alt_text
        ) order by pm.sort_order, a.id
      ),
      '[]'::jsonb
    ) into v_media
    from public.publication_media pm
    join public.media_assets a on a.id = pm.media_asset_id and a.user_id = pm.user_id
    where pm.publication_id = p_publication_id and pm.user_id = v_user_id;
  end if;

  insert into public.publication_history (
    user_id, publication_id, idempotency_key, platform, published_at,
    title_snapshot, copy_snapshot, category_snapshot, tags_snapshot, media_snapshot, notes
  )
  select
    v_user_id, p_publication_id, p_idempotency_key, selected.platform, p_published_at,
    v_publication.title, v_copy, v_category, v_tags, v_media, v_notes
  from (
    select distinct platform
    from unnest(coalesce(p_platforms, '{}'::text[])) as requested(platform)
  ) selected
  on conflict (user_id, idempotency_key, platform) do nothing;
  get diagnostics v_inserted = row_count;

  update public.publications
  set status = 'published', scheduled_for = null, published_at = p_published_at
  where id = p_publication_id and user_id = v_user_id;

  return v_inserted;
end;
$$;

revoke all on function public.record_my_publication_use(uuid, uuid, text[], timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.record_my_publication_use(uuid, uuid, text[], timestamptz, text, text)
  to authenticated;

-- ===================== 20260925000800_recommendations =====================

create table if not exists public.recommendation_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  posts_per_day smallint not null default 3 check (posts_per_day between 1 and 10),
  minimum_repeat_days smallint not null default 14 check (minimum_repeat_days between 0 and 365),
  balance_window_days smallint not null default 14 check (balance_window_days between 1 and 365),
  updated_at timestamptz not null default now()
);

create table if not exists public.category_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null,
  target_share numeric(5,4) check (target_share is null or target_share between 0 and 1),
  priority smallint not null default 2 check (priority between 0 and 5),
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, category_id),
  foreign key (category_id, user_id) references public.categories(id, user_id) on delete cascade
);

alter table public.recommendation_settings enable row level security;
alter table public.category_preferences enable row level security;
revoke all on table public.recommendation_settings, public.category_preferences from public, anon;
grant select, insert, update, delete on table public.recommendation_settings, public.category_preferences to authenticated;

drop policy if exists recommendation_settings_own on public.recommendation_settings;
create policy recommendation_settings_own on public.recommendation_settings
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists category_preferences_own on public.category_preferences;
create policy category_preferences_own on public.category_preferences
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop trigger if exists recommendation_settings_updated_at on public.recommendation_settings;
create trigger recommendation_settings_updated_at before update on public.recommendation_settings
  for each row execute function private.set_updated_at();
drop trigger if exists category_preferences_updated_at on public.category_preferences;
create trigger category_preferences_updated_at before update on public.category_preferences
  for each row execute function private.set_updated_at();

create or replace function public.save_my_recommendation_settings(
  p_posts_per_day smallint,
  p_minimum_repeat_days smallint,
  p_balance_window_days smallint,
  p_categories jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  insert into public.recommendation_settings (user_id, posts_per_day, minimum_repeat_days, balance_window_days)
  values (v_user_id, p_posts_per_day, p_minimum_repeat_days, p_balance_window_days)
  on conflict (user_id) do update set
    posts_per_day = excluded.posts_per_day,
    minimum_repeat_days = excluded.minimum_repeat_days,
    balance_window_days = excluded.balance_window_days;

  insert into public.category_preferences (user_id, category_id, target_share, priority, is_enabled)
  select v_user_id, item.category_id, item.target_share, item.priority, item.is_enabled
  from jsonb_to_recordset(p_categories) as item(
    category_id uuid,
    target_share numeric,
    priority smallint,
    is_enabled boolean
  )
  on conflict (user_id, category_id) do update set
    target_share = excluded.target_share,
    priority = excluded.priority,
    is_enabled = excluded.is_enabled;
end;
$$;

revoke all on function public.save_my_recommendation_settings(smallint, smallint, smallint, jsonb) from public, anon;
grant execute on function public.save_my_recommendation_settings(smallint, smallint, smallint, jsonb) to authenticated;

insert into public.recommendation_settings(user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- ===================== 20260928000100_ai_copy_generation =====================

create table if not exists public.ai_copy_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brief text not null check (char_length(brief) between 10 and 3000),
  platforms text[] not null default '{}',
  status text not null default 'generating' check (status in ('generating', 'succeeded', 'failed')),
  variants jsonb not null default '[]'::jsonb check (jsonb_typeof(variants) = 'array'),
  model text not null,
  failure_code text,
  input_tokens integer,
  output_tokens integer,
  saved_publication_id uuid references public.publications(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists ai_copy_generations_user_month_idx
  on public.ai_copy_generations(user_id, created_at desc);

alter table public.ai_copy_generations enable row level security;
revoke all on table public.ai_copy_generations from public, anon, authenticated;
grant select on table public.ai_copy_generations to authenticated;
drop policy if exists ai_copy_generations_select_own on public.ai_copy_generations;
create policy ai_copy_generations_select_own on public.ai_copy_generations
  for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.start_my_ai_copy_generation(p_brief text, p_platforms text[], p_model text)
returns table(generation_id uuid, used integer, monthly_limit integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_used integer;
  v_id uuid;
  v_limit constant integer := 30;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if char_length(trim(coalesce(p_brief, ''))) not between 10 and 3000 then
    raise exception 'Brief must contain 10 to 3000 characters' using errcode = '22023';
  end if;
  if coalesce(array_length(p_platforms, 1), 0) > 5 or exists (
    select 1 from unnest(coalesce(p_platforms, '{}'::text[])) as p(platform)
    where p.platform not in ('instagram', 'facebook', 'linkedin', 'tiktok', 'x', 'whatsapp')
  ) then raise exception 'Invalid platforms' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || date_trunc('month', now())::text, 0));
  select count(*)::integer into v_used from public.ai_copy_generations g
    where g.user_id = v_user_id and g.created_at >= date_trunc('month', now());
  if v_used >= v_limit then raise exception 'Monthly generation limit reached' using errcode = '54000'; end if;

  insert into public.ai_copy_generations(user_id, brief, platforms, model)
  values (v_user_id, trim(p_brief), coalesce(p_platforms, '{}'::text[]), p_model)
  returning id into v_id;
  return query select v_id, v_used + 1, v_limit;
end;
$$;

create or replace function public.finish_my_ai_copy_generation(
  p_generation_id uuid, p_status text, p_variants jsonb, p_failure_code text,
  p_input_tokens integer, p_output_tokens integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_status not in ('succeeded', 'failed') then raise exception 'Invalid status' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_variants, '[]'::jsonb)) <> 'array' or octet_length(p_variants::text) > 50000 then
    raise exception 'Invalid variants' using errcode = '22023';
  end if;
  update public.ai_copy_generations set
    status = p_status,
    variants = case when p_status = 'succeeded' then p_variants else '[]'::jsonb end,
    failure_code = case when p_status = 'failed' then left(p_failure_code, 80) else null end,
    input_tokens = greatest(p_input_tokens, 0),
    output_tokens = greatest(p_output_tokens, 0),
    completed_at = now()
  where id = p_generation_id and user_id = v_user_id and status = 'generating';
  if not found then raise exception 'Generation not found or already finished' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.mark_my_ai_copy_saved(p_generation_id uuid, p_publication_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if not exists (select 1 from public.publications p where p.id = p_publication_id and p.user_id = v_user_id) then
    raise exception 'Publication not found' using errcode = 'P0002';
  end if;
  update public.ai_copy_generations set saved_publication_id = p_publication_id
  where id = p_generation_id and user_id = v_user_id and status = 'succeeded' and saved_publication_id is null;
  if not found then raise exception 'Generation not found or already saved' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function public.start_my_ai_copy_generation(text, text[], text) from public, anon;
grant execute on function public.start_my_ai_copy_generation(text, text[], text) to authenticated;
revoke all on function public.finish_my_ai_copy_generation(uuid, text, jsonb, text, integer, integer) from public, anon;
grant execute on function public.finish_my_ai_copy_generation(uuid, text, jsonb, text, integer, integer) to authenticated;
revoke all on function public.mark_my_ai_copy_saved(uuid, uuid) from public, anon;
grant execute on function public.mark_my_ai_copy_saved(uuid, uuid) to authenticated;

-- ===================== 20260928000200_ai_copy_draft =====================

-- Saving a reviewed AI variant creates the draft and links it to the generation in one
-- transaction. Retrying the same generation returns the draft created the first time.
create or replace function public.save_my_ai_copy_draft(p_generation_id uuid, p_title text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_generation public.ai_copy_generations%rowtype;
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_publication_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if char_length(v_title) not between 1 and 200 or char_length(v_body) not between 1 and 3000 then
    raise exception 'Title or body length is invalid' using errcode = '22023';
  end if;

  select * into v_generation
  from public.ai_copy_generations g
  where g.id = p_generation_id and g.user_id = v_user_id
  for update;
  if not found or v_generation.status <> 'succeeded' then
    raise exception 'Generation not found' using errcode = 'P0002';
  end if;

  if v_generation.saved_publication_id is not null
     and exists (select 1 from public.publications p where p.id = v_generation.saved_publication_id and p.user_id = v_user_id) then
    return v_generation.saved_publication_id;
  end if;

  insert into public.publications (user_id, title, body, status, platforms)
  values (
    v_user_id, v_title, v_body, 'draft',
    array(select platform from unnest(v_generation.platforms) as g(platform)
          where platform in ('instagram', 'facebook', 'linkedin', 'tiktok', 'x'))
  )
  returning id into v_publication_id;

  update public.ai_copy_generations
  set saved_publication_id = v_publication_id
  where id = p_generation_id and user_id = v_user_id;

  return v_publication_id;
end;
$$;

revoke all on function public.save_my_ai_copy_draft(uuid, text, text) from public, anon;
grant execute on function public.save_my_ai_copy_draft(uuid, text, text) to authenticated;

-- A request that crashed between reserving and finishing a generation would keep the row in
-- 'generating' forever. Allow the owner's next reservation to close stale attempts as failed.
create or replace function public.start_my_ai_copy_generation(p_brief text, p_platforms text[], p_model text)
returns table(generation_id uuid, used integer, monthly_limit integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_used integer;
  v_id uuid;
  v_limit constant integer := 30;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if char_length(trim(coalesce(p_brief, ''))) not between 10 and 3000 then
    raise exception 'Brief must contain 10 to 3000 characters' using errcode = '22023';
  end if;
  if coalesce(array_length(p_platforms, 1), 0) > 6 or exists (
    select 1 from unnest(coalesce(p_platforms, '{}'::text[])) as p(platform)
    where p.platform is null or p.platform not in ('instagram', 'facebook', 'linkedin', 'tiktok', 'x', 'whatsapp')
  ) then raise exception 'Invalid platforms' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || date_trunc('month', now())::text, 0));

  update public.ai_copy_generations
  set status = 'failed', failure_code = 'abandoned', completed_at = now()
  where user_id = v_user_id and status = 'generating' and created_at < now() - interval '10 minutes';

  select count(*)::integer into v_used from public.ai_copy_generations g
    where g.user_id = v_user_id and g.created_at >= date_trunc('month', now());
  if v_used >= v_limit then raise exception 'Monthly generation limit reached' using errcode = '54000'; end if;

  insert into public.ai_copy_generations(user_id, brief, platforms, model)
  values (v_user_id, trim(p_brief), coalesce(p_platforms, '{}'::text[]), p_model)
  returning id into v_id;
  return query select v_id, v_used + 1, v_limit;
end;
$$;

revoke all on function public.start_my_ai_copy_generation(text, text[], text) from public, anon;
grant execute on function public.start_my_ai_copy_generation(text, text[], text) to authenticated;

-- ===================== 20260928000300_schedule_and_campaigns =====================

-- Phase 8: internal scheduling and campaigns.
-- A scheduled post is an intention. Only publication_history records real use; a slot becomes
-- 'fulfilled' exclusively when the owner records that use through record_my_scheduled_post_use.

create or replace function private.account_timezone(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select a.timezone from public.account_preferences a
     where a.user_id = p_user_id
       and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = a.timezone)),
    'America/Tegucigalpa'
  );
$$;
revoke all on function private.account_timezone(uuid) from public, anon, authenticated;

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  goal text not null default '' check (char_length(goal) <= 1000),
  color text not null default '#526e58' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  starts_on date not null,
  ends_on date not null,
  target_posts integer check (target_posts is null or target_posts between 1 and 1000),
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  check (ends_on >= starts_on),
  check (ends_on - starts_on <= 366)
);
create index if not exists campaigns_user_dates_idx on public.campaigns(user_id, is_archived, starts_on, ends_on);
drop trigger if exists campaigns_updated_at on public.campaigns;
create trigger campaigns_updated_at before update on public.campaigns
  for each row execute function private.set_updated_at();

create table if not exists public.scheduled_posts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  publication_id uuid not null,
  campaign_id uuid,
  planned_for timestamptz not null,
  platforms text[] not null default '{}'
    check (cardinality(platforms) <= 5 and platforms <@ array['instagram', 'facebook', 'linkedin', 'tiktok', 'x']::text[]),
  notes text not null default '' check (char_length(notes) <= 1000),
  status text not null default 'planned' check (status in ('planned', 'cancelled', 'fulfilled')),
  history_idempotency_key uuid,
  cancelled_at timestamptz,
  fulfilled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check ((status = 'fulfilled') = (fulfilled_at is not null and history_idempotency_key is not null)),
  foreign key (publication_id, user_id) references public.publications(id, user_id) on delete cascade,
  foreign key (campaign_id, user_id) references public.campaigns(id, user_id)
);
create index if not exists scheduled_posts_user_planned_idx on public.scheduled_posts(user_id, planned_for);
create index if not exists scheduled_posts_publication_idx on public.scheduled_posts(user_id, publication_id, planned_for);
create index if not exists scheduled_posts_campaign_idx on public.scheduled_posts(user_id, campaign_id) where campaign_id is not null;
create unique index if not exists scheduled_posts_history_key on public.scheduled_posts(user_id, history_idempotency_key)
  where history_idempotency_key is not null;
drop trigger if exists scheduled_posts_updated_at on public.scheduled_posts;
create trigger scheduled_posts_updated_at before update on public.scheduled_posts
  for each row execute function private.set_updated_at();

-- Read access is owner-only. Writes go exclusively through the validating functions below.
alter table public.campaigns enable row level security;
alter table public.scheduled_posts enable row level security;
revoke all on table public.campaigns, public.scheduled_posts from public, anon, authenticated;
grant select on table public.campaigns, public.scheduled_posts to authenticated;
drop policy if exists campaigns_select_own on public.campaigns;
create policy campaigns_select_own on public.campaigns
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists scheduled_posts_select_own on public.scheduled_posts;
create policy scheduled_posts_select_own on public.scheduled_posts
  for select to authenticated using ((select auth.uid()) = user_id);

-- Move legacy single-date schedules into slots. Past dates stay 'planned' so they surface as
-- pending confirmation instead of being counted as published.
insert into public.scheduled_posts (id, user_id, publication_id, planned_for, platforms)
select gen_random_uuid(), p.user_id, p.id, p.scheduled_for,
  array(select distinct platform from unnest(p.platforms) as legacy(platform)
        where platform in ('instagram', 'facebook', 'linkedin', 'tiktok', 'x'))
from public.publications p
where p.status = 'scheduled' and p.scheduled_for is not null;

update public.publications
set status = 'draft', scheduled_for = null
where status = 'scheduled';

-- Shared validation for creating or moving a slot.
create or replace function private.validate_scheduled_post(
  p_user_id uuid,
  p_slot_id uuid,
  p_publication_id uuid,
  p_campaign_id uuid,
  p_planned_for timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text := private.account_timezone(p_user_id);
  v_local_day date := (p_planned_for at time zone v_timezone)::date;
  v_campaign public.campaigns%rowtype;
begin
  if p_planned_for is null then
    raise exception 'A planned date is required' using errcode = '22023';
  end if;
  if p_planned_for < now() - interval '5 minutes' then
    raise exception 'Planned date must be in the future' using errcode = '22023';
  end if;
  if p_planned_for > now() + interval '2 years' then
    raise exception 'Planned date is too far in the future' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.publications p
    where p.id = p_publication_id and p.user_id = p_user_id and p.status <> 'archived'
  ) then
    raise exception 'Publication not found or archived' using errcode = 'P0002';
  end if;
  if p_campaign_id is not null then
    select * into v_campaign from public.campaigns c
    where c.id = p_campaign_id and c.user_id = p_user_id;
    if not found or v_campaign.is_archived then
      raise exception 'Campaign not found or archived' using errcode = 'P0002';
    end if;
    if v_local_day not between v_campaign.starts_on and v_campaign.ends_on then
      raise exception 'Planned date is outside the campaign dates' using errcode = '22023';
    end if;
  end if;
  if exists (
    select 1 from public.scheduled_posts s
    where s.user_id = p_user_id
      and s.publication_id = p_publication_id
      and s.status = 'planned'
      and s.id <> p_slot_id
      and (s.planned_for at time zone v_timezone)::date = v_local_day
  ) then
    raise exception 'This publication is already planned for that day' using errcode = '23505';
  end if;
end;
$$;
revoke all on function private.validate_scheduled_post(uuid, uuid, uuid, uuid, timestamptz) from public, anon, authenticated;

create or replace function public.schedule_my_publication(
  p_id uuid,
  p_publication_id uuid,
  p_planned_for timestamptz,
  p_platforms text[],
  p_campaign_id uuid,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_existing public.scheduled_posts%rowtype;
  v_platforms text[];
  v_notes text := btrim(coalesce(p_notes, ''));
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_id is null or p_publication_id is null then
    raise exception 'Slot and publication are required' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_platforms, '{}'::text[])) as selected(platform)
    where platform is null or platform not in ('instagram', 'facebook', 'linkedin', 'tiktok', 'x')
  ) then
    raise exception 'Unsupported platform' using errcode = '22023';
  end if;
  if char_length(v_notes) > 1000 then raise exception 'Notes are too long' using errcode = '22023'; end if;
  v_platforms := array(select distinct platform from unnest(coalesce(p_platforms, '{}'::text[])) as selected(platform) order by platform);

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('scheduled_post:' || p_id::text, 0));

  select * into v_existing from public.scheduled_posts where id = p_id;
  if found then
    -- Retrying the same request returns the slot; reusing the id for other data is rejected.
    if v_existing.user_id = v_user_id
       and v_existing.publication_id = p_publication_id
       and v_existing.planned_for = p_planned_for
       and v_existing.campaign_id is not distinct from p_campaign_id
       and v_existing.platforms = v_platforms
       and v_existing.notes = v_notes then
      return v_existing.id;
    end if;
    raise exception 'Schedule request was reused with different data' using errcode = '22023';
  end if;

  perform private.validate_scheduled_post(v_user_id, p_id, p_publication_id, p_campaign_id, p_planned_for);

  insert into public.scheduled_posts (id, user_id, publication_id, campaign_id, planned_for, platforms, notes)
  values (p_id, v_user_id, p_publication_id, p_campaign_id, p_planned_for, v_platforms, v_notes);
  return p_id;
end;
$$;

create or replace function public.reschedule_my_post(p_id uuid, p_planned_for timestamptz, p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_slot public.scheduled_posts%rowtype;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select * into v_slot from public.scheduled_posts
  where id = p_id and user_id = v_user_id
  for update;
  if not found then raise exception 'Scheduled post not found' using errcode = 'P0002'; end if;
  if v_slot.status <> 'planned' then
    raise exception 'Only planned posts can be moved' using errcode = '55000';
  end if;
  if v_slot.planned_for = p_planned_for and v_slot.campaign_id is not distinct from p_campaign_id then
    return;
  end if;
  perform private.validate_scheduled_post(v_user_id, p_id, v_slot.publication_id, p_campaign_id, p_planned_for);
  update public.scheduled_posts
  set planned_for = p_planned_for, campaign_id = p_campaign_id
  where id = p_id and user_id = v_user_id;
end;
$$;

create or replace function public.cancel_my_scheduled_post(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_slot public.scheduled_posts%rowtype;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select * into v_slot from public.scheduled_posts
  where id = p_id and user_id = v_user_id
  for update;
  if not found then raise exception 'Scheduled post not found' using errcode = 'P0002'; end if;
  if v_slot.status = 'cancelled' then return; end if;
  if v_slot.status = 'fulfilled' then
    raise exception 'A post with recorded use cannot be cancelled' using errcode = '55000';
  end if;
  update public.scheduled_posts
  set status = 'cancelled', cancelled_at = now()
  where id = p_id and user_id = v_user_id;
end;
$$;

-- Records the real use of a planned slot in the history and links both. Retrying with the same
-- idempotency key is safe; the history rows are written by record_my_publication_use.
create or replace function public.record_my_scheduled_post_use(
  p_id uuid,
  p_idempotency_key uuid,
  p_platforms text[],
  p_published_at timestamptz,
  p_copy text,
  p_notes text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_slot public.scheduled_posts%rowtype;
  v_inserted integer;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select * into v_slot from public.scheduled_posts
  where id = p_id and user_id = v_user_id
  for update;
  if not found then raise exception 'Scheduled post not found' using errcode = 'P0002'; end if;
  if v_slot.status = 'cancelled' then
    raise exception 'Cancelled posts cannot be recorded' using errcode = '55000';
  end if;
  if v_slot.status = 'fulfilled' and v_slot.history_idempotency_key <> p_idempotency_key then
    raise exception 'This scheduled post already has a recorded use' using errcode = '55000';
  end if;

  v_inserted := public.record_my_publication_use(
    v_slot.publication_id, p_idempotency_key, p_platforms, p_published_at, p_copy, p_notes
  );

  if v_slot.status = 'planned' then
    update public.scheduled_posts
    set status = 'fulfilled', fulfilled_at = now(), history_idempotency_key = p_idempotency_key
    where id = p_id and user_id = v_user_id;
  end if;
  return v_inserted;
end;
$$;

create or replace function public.save_my_campaign(
  p_id uuid,
  p_name text,
  p_goal text,
  p_color text,
  p_starts_on date,
  p_ends_on date,
  p_target_posts integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_timezone text;
  v_id uuid;
  v_outside integer;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 120
     or char_length(coalesce(p_goal, '')) > 1000
     or coalesce(p_color, '') !~ '^#[0-9A-Fa-f]{6}$'
     or p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on
     or p_ends_on - p_starts_on > 366
     or (p_target_posts is not null and p_target_posts not between 1 and 1000) then
    raise exception 'Invalid campaign' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.campaigns (user_id, name, goal, color, starts_on, ends_on, target_posts)
    values (v_user_id, btrim(p_name), btrim(coalesce(p_goal, '')), p_color, p_starts_on, p_ends_on, p_target_posts)
    returning id into v_id;
    return v_id;
  end if;

  select c.id into v_id from public.campaigns c where c.id = p_id and c.user_id = v_user_id for update;
  if v_id is null then raise exception 'Campaign not found' using errcode = 'P0002'; end if;

  v_timezone := private.account_timezone(v_user_id);
  select count(*)::integer into v_outside
  from public.scheduled_posts s
  where s.user_id = v_user_id and s.campaign_id = p_id and s.status = 'planned'
    and (s.planned_for at time zone v_timezone)::date not between p_starts_on and p_ends_on;
  if v_outside > 0 then
    raise exception '% planned posts fall outside the new campaign dates', v_outside using errcode = '22023';
  end if;

  update public.campaigns
  set name = btrim(p_name), goal = btrim(coalesce(p_goal, '')), color = p_color,
      starts_on = p_starts_on, ends_on = p_ends_on, target_posts = p_target_posts
  where id = p_id and user_id = v_user_id;
  return p_id;
end;
$$;

create or replace function public.set_my_campaign_archived(p_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  update public.campaigns set is_archived = coalesce(p_archived, true)
  where id = p_id and user_id = v_user_id;
  if not found then raise exception 'Campaign not found' using errcode = 'P0002'; end if;
end;
$$;

-- Archiving a publication cancels the intentions that still point at it.
create or replace function private.cancel_slots_for_archived_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'archived' and old.status is distinct from 'archived' then
    update public.scheduled_posts
    set status = 'cancelled', cancelled_at = now()
    where publication_id = new.id and user_id = new.user_id and status = 'planned';
  end if;
  return new;
end;
$$;
revoke all on function private.cancel_slots_for_archived_publication() from public, anon, authenticated;
drop trigger if exists publications_cancel_slots_on_archive on public.publications;
create trigger publications_cancel_slots_on_archive
  after update of status on public.publications
  for each row execute function private.cancel_slots_for_archived_publication();

-- Scheduling now lives in scheduled_posts; the publication editor no longer accepts 'scheduled'.
create or replace function public.save_my_publication(
  p_id uuid,
  p_title text,
  p_body text,
  p_category_id uuid,
  p_status public.publication_status,
  p_scheduled_for timestamptz,
  p_published_at timestamptz,
  p_platforms text[],
  p_media_ids uuid[],
  p_tag_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_status = 'scheduled' or p_scheduled_for is not null then
    raise exception 'Schedule publications from the calendar' using errcode = '22023';
  end if;
  if cardinality(coalesce(p_media_ids, '{}'::uuid[])) > 20
     or cardinality(coalesce(p_tag_ids, '{}'::uuid[])) > 30 then
    raise exception 'Too many media assets or tags' using errcode = '22023';
  end if;
  if array_position(p_media_ids, null) is not null
     or array_position(p_tag_ids, null) is not null then
    raise exception 'Media and tag IDs cannot be null' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_platforms, '{}'::text[])) as selected(platform)
    where platform is null or platform not in ('instagram', 'facebook', 'linkedin', 'tiktok', 'x')
  ) then
    raise exception 'Unsupported platform' using errcode = '22023';
  end if;
  if (p_status = 'published' and p_published_at is null)
     or (p_status <> 'published' and p_published_at is not null) then
    raise exception 'Publication dates do not match status' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.publications (
      user_id, title, body, category_id, status, scheduled_for, published_at, platforms
    ) values (
      v_user_id, p_title, coalesce(p_body, ''), p_category_id, p_status,
      null, p_published_at, coalesce(p_platforms, '{}'::text[])
    ) returning id into v_id;
  else
    update public.publications
    set title = p_title,
        body = coalesce(p_body, ''),
        category_id = p_category_id,
        status = p_status,
        scheduled_for = null,
        published_at = p_published_at,
        platforms = coalesce(p_platforms, '{}'::text[])
    where id = p_id and user_id = v_user_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Publication not found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.publication_media
  where publication_id = v_id and user_id = v_user_id
    and not (media_asset_id = any(coalesce(p_media_ids, '{}'::uuid[])));

  insert into public.publication_media (publication_id, media_asset_id, user_id, sort_order)
  select v_id, media_id, v_user_id, (min(position) - 1)::integer
  from unnest(coalesce(p_media_ids, '{}'::uuid[])) with ordinality as selected(media_id, position)
  group by media_id
  on conflict (publication_id, media_asset_id)
  do update set sort_order = excluded.sort_order;

  delete from public.publication_tags
  where publication_id = v_id and user_id = v_user_id
    and not (tag_id = any(coalesce(p_tag_ids, '{}'::uuid[])));

  insert into public.publication_tags (publication_id, tag_id, user_id)
  select v_id, tag_id, v_user_id
  from unnest(coalesce(p_tag_ids, '{}'::uuid[])) as selected(tag_id)
  where tag_id is not null
  group by tag_id
  on conflict (publication_id, tag_id) do nothing;

  return v_id;
end;
$$;

do $$
declare signature text;
begin
  foreach signature in array array[
    'public.schedule_my_publication(uuid, uuid, timestamptz, text[], uuid, text)',
    'public.reschedule_my_post(uuid, timestamptz, uuid)',
    'public.cancel_my_scheduled_post(uuid)',
    'public.record_my_scheduled_post_use(uuid, uuid, text[], timestamptz, text, text)',
    'public.save_my_campaign(uuid, text, text, text, date, date, integer)',
    'public.set_my_campaign_archived(uuid, boolean)',
    'public.save_my_publication(uuid, text, text, uuid, public.publication_status, timestamptz, timestamptz, text[], uuid[], uuid[])'
  ] loop
    execute format('revoke all on function %s from public, anon', signature);
    execute format('grant execute on function %s to authenticated', signature);
  end loop;
end;
$$;

-- ===================== 20260928000400_ideas_opportunities =====================

-- Phase 9: ideas linked to campaigns and to the draft they produced, atomic conversion, and
-- idempotent ideas saved from history-based opportunities.

alter table public.ideas
  add column if not exists campaign_id uuid,
  add column if not exists publication_id uuid,
  add column if not exists source_key text check (source_key is null or char_length(source_key) between 1 and 200);

do $ideas_fk$
begin
  if not exists (select 1 from pg_constraint where conname = 'ideas_campaign_owner_fkey') then
    alter table public.ideas add constraint ideas_campaign_owner_fkey
      foreign key (campaign_id, user_id) references public.campaigns(id, user_id) on delete set null (campaign_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ideas_publication_owner_fkey') then
    alter table public.ideas add constraint ideas_publication_owner_fkey
      foreign key (publication_id, user_id) references public.publications(id, user_id) on delete set null (publication_id);
  end if;
end
$ideas_fk$;

create unique index if not exists ideas_user_source_key on public.ideas(user_id, source_key) where source_key is not null;
create index if not exists ideas_user_campaign_idx on public.ideas(user_id, campaign_id) where campaign_id is not null;
create index if not exists ideas_publication_owner_idx on public.ideas(publication_id, user_id) where publication_id is not null;

-- Ideas keep their direct owner-scoped policies from the initial schema. The link columns are
-- maintained by the functions below, so direct writes to them are not granted.
revoke insert, update on table public.ideas from authenticated;
grant insert (user_id, title, notes, status, source, campaign_id) on table public.ideas to authenticated;
grant update (title, notes, status, source, campaign_id) on table public.ideas to authenticated;

create or replace function private.validate_idea_campaign()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.campaign_id is not null
     and (tg_op = 'INSERT' or new.campaign_id is distinct from old.campaign_id)
     and exists (select 1 from public.campaigns c where c.id = new.campaign_id and c.user_id = new.user_id and c.is_archived) then
    raise exception 'Campaign is archived' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_idea_campaign() from public, anon, authenticated;
drop trigger if exists ideas_validate_campaign on public.ideas;
create trigger ideas_validate_campaign before insert or update of campaign_id on public.ideas
  for each row execute function private.validate_idea_campaign();

create or replace function public.convert_my_idea_to_draft(p_idea_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_idea public.ideas%rowtype;
  v_publication_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select * into v_idea from public.ideas
  where id = p_idea_id and user_id = v_user_id
  for update;
  if not found then raise exception 'Idea not found' using errcode = 'P0002'; end if;
  if v_idea.status = 'used' and v_idea.publication_id is not null then
    return v_idea.publication_id;
  end if;
  if v_idea.status not in ('inbox', 'planned') then
    raise exception 'Idea cannot be converted' using errcode = '55000';
  end if;

  insert into public.publications (user_id, title, body, status)
  values (v_user_id, left(btrim(v_idea.title), 200), v_idea.notes, 'draft')
  returning id into v_publication_id;

  update public.ideas
  set status = 'used', publication_id = v_publication_id
  where id = p_idea_id and user_id = v_user_id;
  return v_publication_id;
end;
$$;

create or replace function public.save_my_opportunity_idea(p_source_key text, p_title text, p_notes text, p_campaign_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if char_length(coalesce(p_source_key, '')) not between 1 and 200
     or char_length(btrim(coalesce(p_title, ''))) not between 1 and 240
     or char_length(coalesce(p_notes, '')) > 5000 then
    raise exception 'Invalid opportunity' using errcode = '22023';
  end if;
  if p_campaign_id is not null and not exists (
    select 1 from public.campaigns c where c.id = p_campaign_id and c.user_id = v_user_id and not c.is_archived
  ) then
    raise exception 'Campaign not found' using errcode = 'P0002';
  end if;

  insert into public.ideas (user_id, title, notes, status, source, source_key, campaign_id)
  values (v_user_id, btrim(p_title), coalesce(p_notes, ''), 'inbox', 'Oportunidad del historial', p_source_key, p_campaign_id)
  on conflict (user_id, source_key) where source_key is not null do nothing
  returning id into v_id;

  if v_id is null then
    select i.id into v_id from public.ideas i where i.user_id = v_user_id and i.source_key = p_source_key;
  end if;
  return v_id;
end;
$$;

revoke all on function public.convert_my_idea_to_draft(uuid) from public, anon;
grant execute on function public.convert_my_idea_to_draft(uuid) to authenticated;
revoke all on function public.save_my_opportunity_idea(text, text, text, uuid) from public, anon;
grant execute on function public.save_my_opportunity_idea(text, text, text, uuid) to authenticated;

commit;

-- Comprobación: todas las filas deben decir true.
select 'publication_history' as parte, to_regprocedure('public.record_my_publication_use(uuid,uuid,text[],timestamptz,text,text)') is not null as ok
union all select 'recommendations', to_regprocedure('public.save_my_recommendation_settings(smallint,smallint,smallint,jsonb)') is not null
union all select 'ai_copy_generation', to_regclass('public.ai_copy_generations') is not null
union all select 'ai_copy_draft', to_regprocedure('public.save_my_ai_copy_draft(uuid,text,text)') is not null
union all select 'schedule_and_campaigns', to_regclass('public.scheduled_posts') is not null and to_regclass('public.campaigns') is not null
union all select 'ideas_opportunities', to_regprocedure('public.convert_my_idea_to_draft(uuid)') is not null;
