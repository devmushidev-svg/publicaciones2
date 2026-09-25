insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'publication-media',
  'publication-media',
  false,
  26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "publication_media_objects_select_own" on storage.objects;
drop policy if exists "publication_media_objects_insert_own" on storage.objects;
drop policy if exists "publication_media_objects_update_own" on storage.objects;
drop policy if exists "publication_media_objects_delete_own" on storage.objects;

create policy "publication_media_objects_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'publication-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "publication_media_objects_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'publication-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "publication_media_objects_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'publication-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'publication-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "publication_media_objects_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'publication-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
