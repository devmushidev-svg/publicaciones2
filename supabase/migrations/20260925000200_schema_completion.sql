create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text check (full_name is null or (char_length(full_name) <= 100 and length(btrim(full_name)) > 0)),
  timezone text not null default 'America/Tegucigalpa' check (length(btrim(timezone)) between 1 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (full_name, timezone) on table public.profiles to authenticated;
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create or replace function private.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name) values (new.id, nullif(pg_catalog.left(pg_catalog.btrim(new.raw_user_meta_data ->> 'full_name'), 100), '')) on conflict (id) do nothing;
  insert into public.account_preferences (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

create or replace function private.set_profile_updated_at() returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at = pg_catalog.now(); return new; end; $$;
revoke all on function private.set_profile_updated_at() from public, anon, authenticated;
drop trigger if exists set_profile_updated_at on public.profiles;
create trigger set_profile_updated_at before update on public.profiles for each row execute function private.set_profile_updated_at();

create table if not exists public.publication_media (
  publication_id uuid not null,
  media_asset_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  primary key (publication_id, media_asset_id),
  foreign key (publication_id, user_id) references public.publications(id, user_id) on delete cascade,
  foreign key (media_asset_id, user_id) references public.media_assets(id, user_id) on delete cascade
);
create unique index if not exists publications_id_user_id_key on public.publications(id, user_id);
create unique index if not exists media_assets_id_user_id_key on public.media_assets(id, user_id);
create index if not exists publication_media_user_idx on public.publication_media(user_id, publication_id, sort_order);
alter table public.publication_media enable row level security;
revoke all on public.publication_media from public, anon;
grant select, insert, update, delete on public.publication_media to authenticated;
drop policy if exists publication_media_select_own on public.publication_media;
drop policy if exists publication_media_insert_own on public.publication_media;
drop policy if exists publication_media_update_own on public.publication_media;
drop policy if exists publication_media_delete_own on public.publication_media;
create policy publication_media_select_own on public.publication_media for select to authenticated using ((select auth.uid()) = user_id);
create policy publication_media_insert_own on public.publication_media for insert to authenticated with check ((select auth.uid()) = user_id);
create policy publication_media_update_own on public.publication_media for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy publication_media_delete_own on public.publication_media for delete to authenticated using ((select auth.uid()) = user_id);

create unique index if not exists social_connections_id_user_id_key on public.social_connections(id, user_id);
create table if not exists private.social_connection_secrets (
  social_connection_id uuid primary key references public.social_connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (social_connection_id, user_id) references public.social_connections(id, user_id) on delete cascade
);
create unique index if not exists social_connections_id_user_id_key on public.social_connections(id, user_id);
revoke all on table private.social_connection_secrets from public, anon, authenticated;

create index if not exists performance_metrics_publication_owner_idx on public.performance_metrics(publication_id, user_id);
create index if not exists publication_media_asset_owner_idx on public.publication_media(media_asset_id, user_id);
create index if not exists social_connection_secrets_owner_idx on private.social_connection_secrets(user_id);
create index if not exists social_connection_secrets_connection_owner_idx on private.social_connection_secrets(social_connection_id, user_id);
