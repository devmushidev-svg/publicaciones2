begin;

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

create table public.campaigns (
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
create index campaigns_user_dates_idx on public.campaigns(user_id, is_archived, starts_on, ends_on);
create trigger campaigns_updated_at before update on public.campaigns
  for each row execute function private.set_updated_at();

create table public.scheduled_posts (
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
create index scheduled_posts_user_planned_idx on public.scheduled_posts(user_id, planned_for);
create index scheduled_posts_publication_idx on public.scheduled_posts(user_id, publication_id, planned_for);
create index scheduled_posts_campaign_idx on public.scheduled_posts(user_id, campaign_id) where campaign_id is not null;
create unique index scheduled_posts_history_key on public.scheduled_posts(user_id, history_idempotency_key)
  where history_idempotency_key is not null;
create trigger scheduled_posts_updated_at before update on public.scheduled_posts
  for each row execute function private.set_updated_at();

-- Read access is owner-only. Writes go exclusively through the validating functions below.
alter table public.campaigns enable row level security;
alter table public.scheduled_posts enable row level security;
revoke all on table public.campaigns, public.scheduled_posts from public, anon, authenticated;
grant select on table public.campaigns, public.scheduled_posts to authenticated;
create policy campaigns_select_own on public.campaigns
  for select to authenticated using ((select auth.uid()) = user_id);
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

commit;
