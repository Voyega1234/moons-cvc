create table if not exists moons.brand_products (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references moons.clients(id) on delete cascade,
  name text not null,
  description text not null default '',
  key_benefit text,
  audience text,
  offer text,
  price text,
  landing_url text,
  claim_notes text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists brand_products_client_active_idx
  on moons.brand_products (client_id, is_active, sort_order);

create table if not exists moons.brand_documents (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references moons.clients(id) on delete cascade,
  title text not null,
  document_type text not null default 'other',
  file_url text,
  storage_path text,
  mime_type text,
  extracted_text text,
  processing_status text not null default 'uploaded' check (
    processing_status in ('uploaded', 'processing', 'ready_for_ai', 'failed')
  ),
  usable_for_ai boolean not null default false,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists brand_documents_client_status_idx
  on moons.brand_documents (client_id, processing_status, uploaded_at desc);

create table if not exists moons.brand_references (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references moons.clients(id) on delete cascade,
  title text not null,
  reference_type text not null check (
    reference_type in ('inspiration', 'avoid', 'competitor', 'past_winner', 'other')
  ),
  asset_url text,
  source_url text,
  note text not null default '',
  tags text[] not null default '{}',
  is_approved boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists brand_references_client_type_idx
  on moons.brand_references (client_id, reference_type, sort_order);

drop trigger if exists brand_products_set_updated_at on moons.brand_products;
create trigger brand_products_set_updated_at
  before update on moons.brand_products
  for each row execute function moons.set_updated_at();

drop trigger if exists brand_documents_set_updated_at on moons.brand_documents;
create trigger brand_documents_set_updated_at
  before update on moons.brand_documents
  for each row execute function moons.set_updated_at();

drop trigger if exists brand_references_set_updated_at on moons.brand_references;
create trigger brand_references_set_updated_at
  before update on moons.brand_references
  for each row execute function moons.set_updated_at();

grant select, insert, update, delete on moons.brand_products to authenticated;
grant select, insert, update, delete on moons.brand_documents to authenticated;
grant select, insert, update, delete on moons.brand_references to authenticated;

alter table moons.brand_products enable row level security;
alter table moons.brand_documents enable row level security;
alter table moons.brand_references enable row level security;

create policy "convert cake users can manage brand products"
  on moons.brand_products for all
  using (moons.is_convert_cake_user())
  with check (moons.is_convert_cake_user());

create policy "convert cake users can manage brand documents"
  on moons.brand_documents for all
  using (moons.is_convert_cake_user())
  with check (moons.is_convert_cake_user());

create policy "convert cake users can manage brand references"
  on moons.brand_references for all
  using (moons.is_convert_cake_user())
  with check (moons.is_convert_cake_user());
