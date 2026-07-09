insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'brand-assets',
  'brand-assets',
  false,
  52428800,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/csv',
    'text/plain',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "convert cake users can read brand assets"
  on storage.objects;
create policy "convert cake users can read brand assets"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'brand-assets'
    and moons.is_convert_cake_user()
  );

drop policy if exists "convert cake users can upload brand assets"
  on storage.objects;
create policy "convert cake users can upload brand assets"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'brand-assets'
    and moons.is_convert_cake_user()
  );

drop policy if exists "convert cake users can update brand assets"
  on storage.objects;
create policy "convert cake users can update brand assets"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'brand-assets'
    and moons.is_convert_cake_user()
  )
  with check (
    bucket_id = 'brand-assets'
    and moons.is_convert_cake_user()
  );

drop policy if exists "convert cake users can delete brand assets"
  on storage.objects;
create policy "convert cake users can delete brand assets"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'brand-assets'
    and moons.is_convert_cake_user()
  );
