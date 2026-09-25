create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  color text not null default '#71866f' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create unique index categories_user_name_key on public.categories(user_id, lower(btrim(name)));
create index categories_user_active_idx on public.categories(user_id, is_archived, lower(name));

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 50),
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create unique index tags_user_name_key on public.tags(user_id, lower(btrim(name)));
create index tags_user_active_idx on public.tags(user_id, is_archived, lower(name));

create table public.publication_tags (
  publication_id uuid not null,
  tag_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (publication_id, tag_id),
  foreign key (publication_id, user_id) references public.publications(id, user_id) on delete cascade,
  foreign key (tag_id, user_id) references public.tags(id, user_id) on delete cascade
);

create index publication_tags_user_tag_idx on public.publication_tags(user_id, tag_id, publication_id);

alter table public.publications add column category_id uuid;
create index publications_user_category_idx on public.publications(user_id, category_id);
alter table public.publications
  add constraint publications_category_owner_fkey
  foreign key (category_id, user_id) references public.categories(id, user_id);

insert into public.categories(user_id, name)
select distinct on (p.user_id, lower(btrim(p.category))) p.user_id, btrim(p.category)
from public.publications p
where nullif(btrim(p.category), '') is not null
  and char_length(btrim(p.category)) <= 80
  and not exists (
    select 1 from public.categories c
    where c.user_id = p.user_id and lower(btrim(c.name)) = lower(btrim(p.category))
  )
order by p.user_id, lower(btrim(p.category)), btrim(p.category);

update public.publications p
set category_id = c.id
from public.categories c
where c.user_id = p.user_id
  and lower(btrim(c.name)) = lower(btrim(p.category))
  and char_length(btrim(p.category)) <= 80
  and p.category_id is null;

alter table public.publications drop column category;

do $$
declare t text;
begin
  foreach t in array array['categories', 'tags', 'publication_tags'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('create policy %I_select_own on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t, t);
    execute format('create policy %I_insert_own on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t, t);
    execute format('create policy %I_update_own on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t, t);
    execute format('create policy %I_delete_own on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t, t);
  end loop;
end;
$$;

create trigger categories_updated_at before update on public.categories for each row execute function private.set_updated_at();
create trigger tags_updated_at before update on public.tags for each row execute function private.set_updated_at();
