begin;

-- Phase 9: ideas linked to campaigns and to the draft they produced, atomic conversion, and
-- idempotent ideas saved from history-based opportunities.

alter table public.ideas
  add column campaign_id uuid,
  add column publication_id uuid,
  add column source_key text check (source_key is null or char_length(source_key) between 1 and 200),
  add constraint ideas_campaign_owner_fkey
    foreign key (campaign_id, user_id) references public.campaigns(id, user_id) on delete set null (campaign_id),
  add constraint ideas_publication_owner_fkey
    foreign key (publication_id, user_id) references public.publications(id, user_id) on delete set null (publication_id);

create unique index ideas_user_source_key on public.ideas(user_id, source_key) where source_key is not null;
create index ideas_user_campaign_idx on public.ideas(user_id, campaign_id) where campaign_id is not null;
create index ideas_publication_owner_idx on public.ideas(publication_id, user_id) where publication_id is not null;

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
