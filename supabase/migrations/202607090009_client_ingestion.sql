insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'brand-source-assets',
  'brand-source-assets',
  false,
  52428800,
  array[
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

drop policy if exists "convert cake users can read brand source assets"
  on storage.objects;
create policy "convert cake users can read brand source assets"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'brand-source-assets'
    and moons.is_convert_cake_user()
  );

drop policy if exists "convert cake users can upload brand source assets"
  on storage.objects;
create policy "convert cake users can upload brand source assets"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'brand-source-assets'
    and moons.is_convert_cake_user()
  );

drop policy if exists "convert cake users can update brand source assets"
  on storage.objects;
create policy "convert cake users can update brand source assets"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'brand-source-assets'
    and moons.is_convert_cake_user()
  )
  with check (
    bucket_id = 'brand-source-assets'
    and moons.is_convert_cake_user()
  );

drop policy if exists "convert cake users can delete brand source assets"
  on storage.objects;
create policy "convert cake users can delete brand source assets"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'brand-source-assets'
    and moons.is_convert_cake_user()
  );

alter table moons.clients
  add column if not exists facebook_url text,
  add column if not exists ingestion_status text not null default 'not_started',
  add column if not exists ingestion_error text,
  add column if not exists last_ingested_at timestamptz;

alter table moons.clients
  drop constraint if exists clients_ingestion_status_check;

alter table moons.clients
  add constraint clients_ingestion_status_check
  check (
    ingestion_status in (
      'not_started',
      'draft',
      'queued',
      'validating_source',
      'scraping_facebook_posts',
      'scraping_facebook_ads',
      'searching_fallback',
      'mirroring_images',
      'analyzing_visuals',
      'analyzing_brand',
      'writing_memory',
      'ready',
      'needs_review',
      'failed'
    )
  );

create table if not exists moons.brand_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references moons.clients(id) on delete cascade,
  status text not null default 'queued' check (
    status in (
      'queued',
      'validating_source',
      'scraping_facebook_posts',
      'scraping_facebook_ads',
      'searching_fallback',
      'mirroring_images',
      'analyzing_visuals',
      'analyzing_brand',
      'writing_memory',
      'ready',
      'needs_review',
      'failed'
    )
  ),
  current_step text not null default 'queued',
  source_status jsonb not null default '{}'::jsonb,
  error_message text,
  trace_id text,
  created_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists brand_analysis_jobs_client_created_idx
  on moons.brand_analysis_jobs (client_id, created_at desc);

create table if not exists moons.brand_sources (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references moons.clients(id) on delete cascade,
  job_id uuid references moons.brand_analysis_jobs(id) on delete set null,
  source_type text not null check (
    source_type in (
      'facebook_posts',
      'facebook_ads_library',
      'google_search',
      'manual_input'
    )
  ),
  source_url text,
  status text not null check (status in ('succeeded', 'partial', 'failed')),
  raw_payload jsonb not null default '{}'::jsonb,
  error_message text,
  collected_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists brand_sources_client_type_idx
  on moons.brand_sources (client_id, source_type, collected_at desc);

create table if not exists moons.brand_social_posts (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references moons.clients(id) on delete cascade,
  source_id uuid not null references moons.brand_sources(id) on delete cascade,
  post_url text not null,
  text text not null default '',
  likes integer not null default 0 check (likes >= 0),
  shares integer not null default 0 check (shares >= 0),
  comments integer not null default 0 check (comments >= 0),
  media_count integer not null default 0 check (media_count >= 0),
  image_count integer not null default 0 check (image_count >= 0),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_social_posts_source_post_url_key unique (source_id, post_url)
);

create index if not exists brand_social_posts_client_created_idx
  on moons.brand_social_posts (client_id, created_at desc);

create table if not exists moons.brand_ad_library_items (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references moons.clients(id) on delete cascade,
  source_id uuid not null references moons.brand_sources(id) on delete cascade,
  ad_archive_id text not null,
  page_id text,
  page_name text,
  ad_library_url text,
  page_url text,
  is_active boolean not null default false,
  started_at timestamptz,
  ended_at timestamptz,
  platforms text[] not null default '{}',
  display_format text,
  body_text text not null default '',
  title text,
  caption text,
  cta_text text,
  cta_type text,
  link_url text,
  image_count integer not null default 0 check (image_count >= 0),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_ad_library_items_source_ad_archive_key unique (
    source_id,
    ad_archive_id
  )
);

create index if not exists brand_ad_library_items_client_active_idx
  on moons.brand_ad_library_items (client_id, is_active, started_at desc);

create table if not exists moons.brand_visual_assets (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references moons.clients(id) on delete cascade,
  source_id uuid references moons.brand_sources(id) on delete set null,
  social_post_id uuid references moons.brand_social_posts(id) on delete cascade,
  ad_item_id uuid references moons.brand_ad_library_items(id) on delete cascade,
  source_type text not null check (
    source_type in ('facebook_post', 'facebook_ad', 'google_search')
  ),
  source_url text,
  source_item_id text,
  media_kind text not null default 'image' check (media_kind = 'image'),
  original_url_hash text,
  asset_bucket text not null default 'brand-source-assets',
  asset_storage_path text not null,
  asset_url text,
  caption_context text not null default '',
  ocr_text text,
  analysis_status text not null default 'pending' check (
    analysis_status in ('pending', 'analyzing', 'completed', 'failed')
  ),
  visual_summary jsonb not null default '{}'::jsonb,
  raw_vision_output jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_visual_assets_storage_key unique (
    asset_bucket,
    asset_storage_path
  )
);

create index if not exists brand_visual_assets_client_status_idx
  on moons.brand_visual_assets (client_id, analysis_status, created_at desc);

drop trigger if exists brand_analysis_jobs_set_updated_at
  on moons.brand_analysis_jobs;
create trigger brand_analysis_jobs_set_updated_at
  before update on moons.brand_analysis_jobs
  for each row execute function moons.set_updated_at();

drop trigger if exists brand_social_posts_set_updated_at
  on moons.brand_social_posts;
create trigger brand_social_posts_set_updated_at
  before update on moons.brand_social_posts
  for each row execute function moons.set_updated_at();

drop trigger if exists brand_ad_library_items_set_updated_at
  on moons.brand_ad_library_items;
create trigger brand_ad_library_items_set_updated_at
  before update on moons.brand_ad_library_items
  for each row execute function moons.set_updated_at();

drop trigger if exists brand_visual_assets_set_updated_at
  on moons.brand_visual_assets;
create trigger brand_visual_assets_set_updated_at
  before update on moons.brand_visual_assets
  for each row execute function moons.set_updated_at();

grant select, insert, update, delete on moons.clients to authenticated;
grant select, insert, update, delete on moons.brand_analysis_jobs to authenticated;
grant select, insert, update, delete on moons.brand_sources to authenticated;
grant select, insert, update, delete on moons.brand_social_posts to authenticated;
grant select, insert, update, delete on moons.brand_ad_library_items to authenticated;
grant select, insert, update, delete on moons.brand_visual_assets to authenticated;

alter table moons.brand_analysis_jobs enable row level security;
alter table moons.brand_sources enable row level security;
alter table moons.brand_social_posts enable row level security;
alter table moons.brand_ad_library_items enable row level security;
alter table moons.brand_visual_assets enable row level security;

drop policy if exists "convert cake users can manage clients"
  on moons.clients;
create policy "convert cake users can manage clients"
  on moons.clients for all
  using (moons.is_convert_cake_user())
  with check (moons.is_convert_cake_user());

drop policy if exists "convert cake users can manage brand analysis jobs"
  on moons.brand_analysis_jobs;
create policy "convert cake users can manage brand analysis jobs"
  on moons.brand_analysis_jobs for all
  using (moons.is_convert_cake_user())
  with check (moons.is_convert_cake_user());

drop policy if exists "convert cake users can manage brand sources"
  on moons.brand_sources;
create policy "convert cake users can manage brand sources"
  on moons.brand_sources for all
  using (moons.is_convert_cake_user())
  with check (moons.is_convert_cake_user());

drop policy if exists "convert cake users can manage brand social posts"
  on moons.brand_social_posts;
create policy "convert cake users can manage brand social posts"
  on moons.brand_social_posts for all
  using (moons.is_convert_cake_user())
  with check (moons.is_convert_cake_user());

drop policy if exists "convert cake users can manage brand ad library items"
  on moons.brand_ad_library_items;
create policy "convert cake users can manage brand ad library items"
  on moons.brand_ad_library_items for all
  using (moons.is_convert_cake_user())
  with check (moons.is_convert_cake_user());

drop policy if exists "convert cake users can manage brand visual assets"
  on moons.brand_visual_assets;
create policy "convert cake users can manage brand visual assets"
  on moons.brand_visual_assets for all
  using (moons.is_convert_cake_user())
  with check (moons.is_convert_cake_user());
