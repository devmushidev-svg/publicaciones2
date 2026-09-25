begin;

alter table public.media_assets
  add column content_sha256 text check (content_sha256 ~ '^[0-9a-f]{64}$');

create unique index media_assets_user_hash_key
  on public.media_assets(user_id, content_sha256)
  where content_sha256 is not null;

do $$
begin
  if exists (
    select 1
    from public.publications p
    cross join lateral unnest(coalesce(p.media_ids, '{}'::uuid[])) as legacy(media_id)
    left join public.media_assets a on a.id = legacy.media_id and a.user_id = p.user_id
    where a.id is null
  ) then
    raise exception 'Legacy publication media contains missing or foreign assets; reconcile it before this migration';
  end if;
end;
$$;

insert into public.publication_media (publication_id, media_asset_id, user_id, sort_order)
select p.id, legacy.media_id, p.user_id, (min(legacy.position) - 1)::integer
from public.publications p
cross join lateral unnest(coalesce(p.media_ids, '{}'::uuid[])) with ordinality as legacy(media_id, position)
group by p.id, legacy.media_id, p.user_id
on conflict (publication_id, media_asset_id) do nothing;

alter table public.publications drop column media_ids;

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
  if (p_status = 'scheduled' and p_scheduled_for is null)
     or (p_status <> 'scheduled' and p_scheduled_for is not null)
     or (p_status = 'published' and p_published_at is null)
     or (p_status <> 'published' and p_published_at is not null) then
    raise exception 'Publication dates do not match status' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.publications (
      user_id, title, body, category_id, status, scheduled_for, published_at, platforms
    ) values (
      v_user_id, p_title, coalesce(p_body, ''), p_category_id, p_status,
      p_scheduled_for, p_published_at, coalesce(p_platforms, '{}'::text[])
    ) returning id into v_id;
  else
    update public.publications
    set title = p_title,
        body = coalesce(p_body, ''),
        category_id = p_category_id,
        status = p_status,
        scheduled_for = p_scheduled_for,
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

revoke all on function public.save_my_publication(
  uuid, text, text, uuid, public.publication_status, timestamptz,
  timestamptz, text[], uuid[], uuid[]
) from public, anon;
grant execute on function public.save_my_publication(
  uuid, text, text, uuid, public.publication_status, timestamptz,
  timestamptz, text[], uuid[], uuid[]
) to authenticated;

commit;
