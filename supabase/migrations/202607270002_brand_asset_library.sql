create table if not exists moons.brand_asset_folders (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references moons.clients(id) on delete cascade,
  parent_id uuid,
  asset_kind text not null check (asset_kind in ('material', 'reference')),
  name text not null check (length(btrim(name)) between 1 and 120),
  source_provider text check (source_provider in ('google-drive')),
  source_id text,
  source_url text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((source_provider is null) = (source_id is null)),
  unique (id, client_id, asset_kind),
  foreign key (parent_id, client_id, asset_kind)
    references moons.brand_asset_folders (id, client_id, asset_kind)
    on delete cascade
);

create unique index if not exists brand_asset_folders_drive_source_unique
  on moons.brand_asset_folders (client_id, asset_kind, source_provider, source_id)
  where source_id is not null;

create unique index if not exists brand_asset_folders_root_name_unique
  on moons.brand_asset_folders (client_id, asset_kind, lower(name))
  where parent_id is null;

create unique index if not exists brand_asset_folders_child_name_unique
  on moons.brand_asset_folders (client_id, asset_kind, parent_id, lower(name))
  where parent_id is not null;

create index if not exists brand_asset_folders_parent_idx
  on moons.brand_asset_folders (client_id, asset_kind, parent_id, name);

create table if not exists moons.brand_assets (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references moons.clients(id) on delete cascade,
  folder_id uuid,
  asset_kind text not null check (asset_kind in ('material', 'reference')),
  name text not null,
  mime_type text not null check (
    mime_type in ('image/png', 'image/jpeg', 'image/webp')
  ),
  storage_path text not null,
  source_provider text check (source_provider in ('google-drive')),
  source_id text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((source_provider is null) = (source_id is null)),
  foreign key (folder_id, client_id, asset_kind)
    references moons.brand_asset_folders (id, client_id, asset_kind)
    on delete cascade
);

create unique index if not exists brand_assets_drive_source_unique
  on moons.brand_assets (client_id, asset_kind, source_provider, source_id)
  where source_id is not null;

create index if not exists brand_assets_folder_idx
  on moons.brand_assets (client_id, asset_kind, folder_id, created_at);

drop trigger if exists brand_asset_folders_set_updated_at
  on moons.brand_asset_folders;
create trigger brand_asset_folders_set_updated_at
  before update on moons.brand_asset_folders
  for each row execute function moons.set_updated_at();

drop trigger if exists brand_assets_set_updated_at on moons.brand_assets;
create trigger brand_assets_set_updated_at
  before update on moons.brand_assets
  for each row execute function moons.set_updated_at();

grant select, insert, update, delete on moons.brand_asset_folders to authenticated;
grant select, insert, update, delete on moons.brand_assets to authenticated;

alter table moons.brand_asset_folders enable row level security;
alter table moons.brand_assets enable row level security;

create policy "convert cake users can manage brand asset folders"
  on moons.brand_asset_folders for all
  using (moons.is_convert_cake_user())
  with check (moons.is_convert_cake_user());

create policy "convert cake users can manage brand assets"
  on moons.brand_assets for all
  using (moons.is_convert_cake_user())
  with check (moons.is_convert_cake_user());
