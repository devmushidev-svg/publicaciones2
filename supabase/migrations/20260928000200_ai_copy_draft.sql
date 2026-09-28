begin;

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

commit;
