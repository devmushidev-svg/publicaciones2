begin;

-- A connection is only trustworthy when it was completed through the OAuth flow.
revoke insert, update, delete on public.social_connections from authenticated;
drop policy if exists social_connections_insert_own on public.social_connections;
drop policy if exists social_connections_update_own on public.social_connections;
drop policy if exists social_connections_delete_own on public.social_connections;
alter table public.social_connections add column token_expires_at timestamptz;
update public.social_connections c set is_active = false
where provider in ('facebook', 'instagram')
  and not exists (select 1 from private.social_connection_secrets s where s.social_connection_id = c.id);

create table private.meta_connection_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pages jsonb not null check (jsonb_typeof(pages) = 'array'),
  token_expires_at timestamptz,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now()
);
create index meta_connection_attempts_owner_idx on private.meta_connection_attempts(user_id, expires_at);
revoke all on private.meta_connection_attempts from public, anon, authenticated;

create function public.begin_my_meta_connection(p_user_id uuid, p_pages jsonb, p_token_expires_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_user_id is null then raise exception 'User required' using errcode = '22023'; end if;
  if pg_catalog.jsonb_typeof(p_pages) <> 'array' or pg_catalog.jsonb_array_length(p_pages) not between 1 and 100 then
    raise exception 'Invalid pages' using errcode = '22023';
  end if;
  if pg_catalog.octet_length(p_pages::text) > 131072 or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_pages) as item(page)
    where nullif(pg_catalog.btrim(item.page->>'id'), '') is null
      or nullif(pg_catalog.btrim(item.page->>'name'), '') is null
      or nullif(pg_catalog.btrim(item.page->>'access_token'), '') is null
  ) then
    raise exception 'Invalid pages' using errcode = '22023';
  end if;

  delete from private.meta_connection_attempts where user_id = p_user_id;
  insert into private.meta_connection_attempts(user_id, pages, token_expires_at)
  values (p_user_id, p_pages, p_token_expires_at) returning id into v_id;
  return v_id;
end;
$$;

create function public.list_my_meta_connection_pages(p_attempt_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', item.page->>'id',
      'name', item.page->>'name',
      'instagram_id', item.page->'instagram_business_account'->>'id',
      'instagram_username', item.page->'instagram_business_account'->>'username'
    ) order by item.page->>'name'
  ), '[]'::jsonb)
  from private.meta_connection_attempts a
  cross join lateral pg_catalog.jsonb_array_elements(a.pages) as item(page)
  where a.id = p_attempt_id and a.user_id = auth.uid() and a.expires_at > pg_catalog.now();
$$;

create function public.finish_my_meta_connection(p_attempt_id uuid, p_page_id text, p_include_instagram boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_pages jsonb;
  v_page jsonb;
  v_expires_at timestamptz;
  v_connection_id uuid;
  v_ig_id text;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select a.pages, a.token_expires_at into v_pages, v_expires_at
  from private.meta_connection_attempts a
  where a.id = p_attempt_id and a.user_id = v_user and a.expires_at > pg_catalog.now()
  for update;
  select item.page into v_page from pg_catalog.jsonb_array_elements(v_pages) as item(page)
  where item.page->>'id' = p_page_id;
  if v_page is null then raise exception 'Connection attempt expired or page unavailable' using errcode = 'P0002'; end if;
  v_ig_id := v_page->'instagram_business_account'->>'id';
  if p_include_instagram and nullif(v_ig_id, '') is null then
    raise exception 'No professional Instagram account is linked to this Page' using errcode = '22023';
  end if;

  insert into public.social_connections(user_id, provider, account_name, account_external_id, is_active, token_expires_at)
  values (v_user, 'facebook', v_page->>'name', p_page_id, true, v_expires_at)
  on conflict (user_id, provider) do update set
    account_name = excluded.account_name, account_external_id = excluded.account_external_id,
    connected_at = pg_catalog.now(), last_synced_at = null, is_active = true,
    token_expires_at = excluded.token_expires_at
  returning id into v_connection_id;
  insert into private.social_connection_secrets(social_connection_id, user_id, access_token, token_expires_at)
  values (v_connection_id, v_user, v_page->>'access_token', v_expires_at)
  on conflict (social_connection_id) do update set
    access_token = excluded.access_token, token_expires_at = excluded.token_expires_at,
    refresh_token = null, updated_at = pg_catalog.now();

  if p_include_instagram then
    insert into public.social_connections(user_id, provider, account_name, account_external_id, is_active, token_expires_at)
    values (v_user, 'instagram', coalesce(nullif(v_page->'instagram_business_account'->>'username', ''), 'Instagram de ' || (v_page->>'name')), v_ig_id, true, v_expires_at)
    on conflict (user_id, provider) do update set
      account_name = excluded.account_name, account_external_id = excluded.account_external_id,
      connected_at = pg_catalog.now(), last_synced_at = null, is_active = true,
      token_expires_at = excluded.token_expires_at
    returning id into v_connection_id;
    insert into private.social_connection_secrets(social_connection_id, user_id, access_token, token_expires_at)
    values (v_connection_id, v_user, v_page->>'access_token', v_expires_at)
    on conflict (social_connection_id) do update set
      access_token = excluded.access_token, token_expires_at = excluded.token_expires_at,
      refresh_token = null, updated_at = pg_catalog.now();
  else
    delete from public.social_connections where user_id = v_user and provider = 'instagram';
  end if;

  delete from private.meta_connection_attempts where id = p_attempt_id and user_id = v_user;
end;
$$;

create function public.disconnect_my_meta_connection(p_provider public.connection_provider)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_provider not in ('facebook', 'instagram') then
    raise exception 'Unsupported provider' using errcode = '22023';
  end if;
  delete from public.social_connections
  where user_id = v_user and (provider = p_provider or (p_provider = 'facebook' and provider = 'instagram'));
end;
$$;

revoke all on function public.begin_my_meta_connection(uuid,jsonb,timestamptz) from public, anon, authenticated;
revoke all on function public.list_my_meta_connection_pages(uuid) from public, anon;
revoke all on function public.finish_my_meta_connection(uuid,text,boolean) from public, anon;
revoke all on function public.disconnect_my_meta_connection(public.connection_provider) from public, anon;
grant execute on function public.begin_my_meta_connection(uuid,jsonb,timestamptz) to service_role;
grant execute on function public.list_my_meta_connection_pages(uuid) to authenticated;
grant execute on function public.finish_my_meta_connection(uuid,text,boolean) to authenticated;
grant execute on function public.disconnect_my_meta_connection(public.connection_provider) to authenticated;

commit;
