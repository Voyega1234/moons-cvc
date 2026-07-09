insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'creative-assets',
  'creative-assets',
  false,
  52428800,
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

drop policy if exists "convert cake users can read creative assets"
  on storage.objects;
create policy "convert cake users can read creative assets"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'creative-assets'
    and moons.is_convert_cake_user()
  );

drop policy if exists "convert cake users can upload creative assets"
  on storage.objects;
create policy "convert cake users can upload creative assets"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'creative-assets'
    and moons.is_convert_cake_user()
  );

drop policy if exists "convert cake users can update creative assets"
  on storage.objects;
create policy "convert cake users can update creative assets"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'creative-assets'
    and moons.is_convert_cake_user()
  )
  with check (
    bucket_id = 'creative-assets'
    and moons.is_convert_cake_user()
  );

drop policy if exists "convert cake users can delete creative assets"
  on storage.objects;
create policy "convert cake users can delete creative assets"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'creative-assets'
    and moons.is_convert_cake_user()
  );

alter table moons.outputs
  add column if not exists asset_bucket text,
  add column if not exists asset_storage_path text,
  add column if not exists provider text,
  add column if not exists model text;

create index if not exists outputs_asset_storage_path_idx
  on moons.outputs (asset_bucket, asset_storage_path)
  where asset_storage_path is not null;
