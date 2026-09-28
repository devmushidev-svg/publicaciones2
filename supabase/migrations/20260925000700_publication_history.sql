begin;

create table public.publication_history (
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

create index publication_history_user_date_idx
  on public.publication_history(user_id, published_at desc, id desc);
create index publication_history_publication_date_idx
  on public.publication_history(user_id, publication_id, published_at desc);
create index publication_history_platform_date_idx
  on public.publication_history(user_id, platform, published_at desc);

alter table public.publication_history enable row level security;
revoke all on table public.publication_history from public, anon, authenticated;
grant select on table public.publication_history to authenticated;
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

commit;
