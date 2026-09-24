create type public.publication_status as enum ('draft', 'scheduled', 'published', 'archived');
create type public.idea_status as enum ('inbox', 'planned', 'used', 'archived');
create type public.connection_provider as enum ('instagram', 'facebook', 'linkedin', 'tiktok', 'x');

create table public.publications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body text not null default '',
  status public.publication_status not null default 'draft',
  scheduled_for timestamptz,
  published_at timestamptz,
  platforms text[] not null default '{}',
  media_ids uuid[] not null default '{}',
  category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'scheduled' or scheduled_for is not null)
);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null check (char_length(btrim(storage_path)) > 0),
  file_name text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  alt_text text,
  created_at timestamptz not null default now()
);

create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 240),
  notes text not null default '',
  status public.idea_status not null default 'inbox',
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.performance_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  publication_id uuid references public.publications(id) on delete cascade,
  platform text not null,
  measured_on date not null,
  reach integer not null default 0 check (reach >= 0),
  impressions integer not null default 0 check (impressions >= 0),
  engagements integer not null default 0 check (engagements >= 0),
  clicks integer not null default 0 check (clicks >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, publication_id, platform, measured_on)
);

create table public.social_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider public.connection_provider not null,
  account_name text not null,
  account_external_id text,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  is_active boolean not null default true,
  unique (user_id, provider)
);

create table public.account_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'America/Tegucigalpa',
  week_starts_on smallint not null default 1 check (week_starts_on between 0 and 6),
  email_digest boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index publications_user_schedule_idx on public.publications(user_id, scheduled_for);
create index publications_user_status_idx on public.publications(user_id, status);
create index media_assets_user_created_idx on public.media_assets(user_id, created_at desc);
create index ideas_user_status_idx on public.ideas(user_id, status);
create index metrics_user_date_idx on public.performance_metrics(user_id, measured_on desc);
create index connections_user_active_idx on public.social_connections(user_id, is_active);

create or replace function private.set_updated_at() returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at = pg_catalog.now(); return new; end; $$;
create trigger publications_updated_at before update on public.publications for each row execute function private.set_updated_at();
create trigger ideas_updated_at before update on public.ideas for each row execute function private.set_updated_at();
create trigger preferences_updated_at before update on public.account_preferences for each row execute function private.set_updated_at();

create or replace function private.create_default_preferences() returns trigger language plpgsql security definer set search_path = '' as $$ begin insert into public.account_preferences(user_id) values(new.id) on conflict do nothing; return new; end; $$;
create trigger on_auth_user_created_preferences after insert on auth.users for each row execute function private.create_default_preferences();

alter table public.publications enable row level security;
alter table public.media_assets enable row level security;
alter table public.ideas enable row level security;
alter table public.performance_metrics enable row level security;
alter table public.social_connections enable row level security;
alter table public.account_preferences enable row level security;

revoke all on public.publications, public.media_assets, public.ideas, public.performance_metrics, public.social_connections, public.account_preferences from public, anon;
grant select, insert, update, delete on public.publications, public.media_assets, public.ideas, public.performance_metrics, public.social_connections, public.account_preferences to authenticated;

do $$ declare t text; begin foreach t in array array['publications','media_assets','ideas','performance_metrics','social_connections','account_preferences'] loop execute format('create policy %I_select_own on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t, t); execute format('create policy %I_insert_own on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t, t); execute format('create policy %I_update_own on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t, t); execute format('create policy %I_delete_own on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t, t); end loop; end $$;

revoke all on function private.set_updated_at(), private.create_default_preferences() from public, anon, authenticated;
