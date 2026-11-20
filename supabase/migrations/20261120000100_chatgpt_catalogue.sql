begin;

alter table public.categories add column parent_id uuid;
alter table public.categories add column manual_only boolean not null default false;
alter table public.categories add constraint categories_parent_owner_fkey
  foreign key (parent_id,user_id) references public.categories(id,user_id);
alter table public.categories add constraint categories_not_own_parent check (parent_id is distinct from id);
alter table public.publications add column approved_for_batch boolean not null default false;
alter table public.publications add column valid_until date;
alter table public.publications add column facebook_page text not null default 'tocoa'
  check (facebook_page in ('tocoa','floristeria'));
alter table public.scheduled_posts add column mcp_snapshot jsonb;

-- Existing flower designs remain manual. Floral supplies are a separate category.
update public.categories set manual_only=true
where name ~* '(flores|florer|florister|ramos|arreglos florales)'
  and name !~* '(suministros|insumos|materiales)';

create function public.save_my_catalogue_publication(
  p_id uuid,p_title text,p_body text,p_category_id uuid,p_status public.publication_status,
  p_published_at timestamptz,p_platforms text[],p_media_ids uuid[],p_tag_ids uuid[],
  p_approved_for_batch boolean,p_valid_until date,p_facebook_page text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_manual boolean;
begin
  select manual_only into v_manual from public.categories where id=p_category_id and user_id=auth.uid();
  v_id := public.save_my_publication(p_id,p_title,p_body,p_category_id,p_status,null,
                                    p_published_at,p_platforms,p_media_ids,p_tag_ids);
  update public.publications set approved_for_batch=coalesce(p_approved_for_batch,false) and not coalesce(v_manual,false),
    valid_until=p_valid_until,facebook_page=p_facebook_page where id=v_id and user_id=auth.uid();
  return v_id;
end; $$;
revoke all on function public.save_my_catalogue_publication(uuid,text,text,uuid,public.publication_status,timestamptz,text[],uuid[],uuid[],boolean,date,text) from public,anon;
grant execute on function public.save_my_catalogue_publication(uuid,text,text,uuid,public.publication_status,timestamptz,text[],uuid[],uuid[],boolean,date,text) to authenticated;

-- A whole confirmed MCP plan appears in the existing calendar, or none of it does.
create table private.catalogue_save_requests (
  user_id uuid not null references auth.users(id),request_id uuid not null,
  publication_id uuid not null references public.publications(id),payload jsonb not null,
  primary key(user_id,request_id)
);
revoke all on private.catalogue_save_requests from public,anon,authenticated;
create function public.save_my_mcp_publication(p_request_id uuid,p_content jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_existing private.catalogue_save_requests%rowtype; v_id uuid; v_uid uuid:=auth.uid();
begin
  if v_uid is null then raise exception 'Authentication required' using errcode='28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  select * into v_existing from private.catalogue_save_requests where user_id=v_uid and request_id=p_request_id;
  if found then
    if v_existing.payload<>p_content then raise exception 'Request reused with different content' using errcode='22023'; end if;
    return v_existing.publication_id;
  end if;
  v_id:=public.save_my_catalogue_publication(null,p_content->>'titulo',p_content->>'texto',
    (p_content->>'categoria')::uuid,'draft',null,array['facebook']::text[],
    array(select value::uuid from jsonb_array_elements_text(coalesce(p_content->'imagenes','[]'::jsonb))),
    '{}'::uuid[],coalesce((p_content->>'automatica')::boolean,false),
    nullif(p_content->>'vence','')::date,coalesce(p_content->>'pagina','tocoa'));
  insert into private.catalogue_save_requests values(v_uid,p_request_id,v_id,p_content);
  return v_id;
end; $$;
revoke all on function public.save_my_mcp_publication(uuid,jsonb) from public,anon;
grant execute on function public.save_my_mcp_publication(uuid,jsonb) to authenticated;

-- IDs supplied by the MCP are stable, so retrying after a lost response is safe.
create function public.register_my_mcp_plan(p_plan_id uuid,p_jobs jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare v_job jsonb; v_count integer:=0; v_uid uuid:=auth.uid(); v_publication public.publications%rowtype;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if p_plan_id is null or jsonb_typeof(p_jobs) is distinct from 'array' or jsonb_array_length(p_jobs) not between 1 and 500 then
    raise exception 'Invalid plan' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  for v_job in select value from jsonb_array_elements(p_jobs) loop
    select * into v_publication from public.publications
      where id=(v_job->>'publication_id')::uuid and user_id=v_uid and status<>'archived' for update;
    if not found then raise exception 'Publication not available' using errcode='P0002'; end if;
    if v_publication.valid_until is not null and v_publication.valid_until <
      ((v_job->>'planned_for')::timestamptz at time zone private.account_timezone(v_uid))::date then
      raise exception 'Publication expired' using errcode='22023';
    end if;
    perform public.schedule_my_publication((v_job->>'id')::uuid,v_publication.id,
      (v_job->>'planned_for')::timestamptz,array['facebook']::text[],null,
      'ChatGPT: '||p_plan_id::text||' | Página: '||(v_job->>'page')||' | En cola local');
    if jsonb_typeof(v_job->'snapshot') is distinct from 'object' then
      raise exception 'Missing approved snapshot' using errcode='22023';
    end if;
    if exists(select 1 from jsonb_array_elements_text(v_job->'snapshot'->'imagenes') n(name)
      where not exists(select 1 from public.media_assets m where m.id=split_part(n.name,'.',1)::uuid and m.user_id=v_uid)) then
      raise exception 'Image not owned' using errcode='23503';
    end if;
    update public.scheduled_posts set mcp_snapshot=v_job->'snapshot'||jsonb_build_object('media',
      coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'storage_path',m.storage_path,'file_name',m.file_name,
        'mime_type',m.mime_type,'alt_text',m.alt_text) order by n.ord)
        from jsonb_array_elements_text(v_job->'snapshot'->'imagenes') with ordinality n(name,ord)
        join public.media_assets m on m.id=split_part(n.name,'.',1)::uuid and m.user_id=v_uid),'[]'::jsonb))
      where id=(v_job->>'id')::uuid and user_id=v_uid and mcp_snapshot is null;
    v_count:=v_count+1;
  end loop;
  return v_count;
end; $$;
revoke all on function public.register_my_mcp_plan(uuid,jsonb) from public,anon;
grant execute on function public.register_my_mcp_plan(uuid,jsonb) to authenticated;

create function public.cancel_my_mcp_plan(p_plan_id uuid,p_job_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_slot public.scheduled_posts%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='28000'; end if;
  foreach v_id in array p_job_ids loop
    select * into v_slot from public.scheduled_posts where id=v_id and user_id=auth.uid() for update;
    if found then
      if v_slot.notes not like 'ChatGPT: '||p_plan_id::text||' |%' then
        raise exception 'Plan does not own this slot' using errcode='22023';
      end if;
      if v_slot.status<>'fulfilled' then perform public.cancel_my_scheduled_post(v_id); end if;
    end if;
  end loop;
end; $$;
revoke all on function public.cancel_my_mcp_plan(uuid,uuid[]) from public,anon;
grant execute on function public.cancel_my_mcp_plan(uuid,uuid[]) to authenticated;

create function public.update_my_mcp_delivery(p_id uuid,p_state text,p_post_id text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if p_state not in ('En Meta','Requiere revisión','Horario vencido') then
    raise exception 'Invalid delivery state' using errcode='22023';
  end if;
  update public.scheduled_posts set notes=split_part(notes,' | Estado:',1)||' | Estado: '||p_state||
    case when p_post_id is not null then ' | ID Meta: '||left(p_post_id,100) else '' end
    where id=p_id and user_id=auth.uid() and notes like 'ChatGPT:%';
  if not found then raise exception 'Slot not found' using errcode='P0002'; end if;
end; $$;
revoke all on function public.update_my_mcp_delivery(uuid,text,text) from public,anon;
grant execute on function public.update_my_mcp_delivery(uuid,text,text) to authenticated;

create function public.record_my_mcp_use(p_id uuid,p_published_at timestamptz,p_post_id text)
returns void language plpgsql security definer set search_path='' as $$
declare v_snapshot jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='28000'; end if;
  select mcp_snapshot into v_snapshot from public.scheduled_posts where id=p_id and user_id=auth.uid() for update;
  if v_snapshot is null then raise exception 'MCP snapshot not found' using errcode='P0002'; end if;
  perform public.record_my_scheduled_post_use(p_id,p_id,array['facebook']::text[],p_published_at,
    v_snapshot->>'texto','Publicado por ChatGPT. ID Meta: '||left(p_post_id,100));
  update public.publication_history set title_snapshot=v_snapshot->>'titulo',copy_snapshot=v_snapshot->>'texto',
    media_snapshot=v_snapshot->'media'
    where user_id=auth.uid() and idempotency_key=p_id and platform='facebook';
end; $$;
revoke all on function public.record_my_mcp_use(uuid,timestamptz,text) from public,anon;
grant execute on function public.record_my_mcp_use(uuid,timestamptz,text) to authenticated;

commit;
