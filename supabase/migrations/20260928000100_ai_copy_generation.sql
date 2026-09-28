begin;

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

commit;
