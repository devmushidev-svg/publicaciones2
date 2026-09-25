create or replace function public.update_my_settings(
  p_full_name text,
  p_timezone text,
  p_week_starts_on smallint,
  p_email_digest boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_full_name is null or char_length(p_full_name) not between 1 and 100 or length(btrim(p_full_name)) = 0 then
    raise exception 'Invalid name' using errcode = '22023';
  end if;
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Invalid timezone' using errcode = '22023';
  end if;
  if p_week_starts_on is null or p_week_starts_on not between 0 and 6 or p_email_digest is null then
    raise exception 'Invalid preferences' using errcode = '22023';
  end if;

  update public.profiles
  set full_name = p_full_name, timezone = p_timezone
  where id = current_user_id;
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  insert into public.account_preferences (user_id, timezone, week_starts_on, email_digest)
  values (current_user_id, p_timezone, p_week_starts_on, p_email_digest)
  on conflict (user_id) do update
    set timezone = excluded.timezone,
        week_starts_on = excluded.week_starts_on,
        email_digest = excluded.email_digest;
end;
$$;

revoke all on function public.update_my_settings(text, text, smallint, boolean) from public, anon;
grant execute on function public.update_my_settings(text, text, smallint, boolean) to authenticated;
