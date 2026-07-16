insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'artwork-reference-library',
  'artwork-reference-library',
  false,
  20971520,
  array[
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "convert cake users can read artwork references"
  on storage.objects;
create policy "convert cake users can read artwork references"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'artwork-reference-library'
    and moons.is_convert_cake_user()
  );

