begin;

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

commit;
