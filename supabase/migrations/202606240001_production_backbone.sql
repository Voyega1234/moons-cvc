create extension if not exists pgcrypto;

create schema if not exists moons;

grant usage on schema moons to anon, authenticated, service_role;

create or replace function moons.is_convert_cake_user()
returns boolean
language sql
stable
as $$
  select coalesce(
    auth.role() = 'authenticated'
    and (
      auth.jwt() -> 'app_metadata' ->> 'organization' = 'convert_cake'
      or lower(coalesce(auth.jwt() ->> 'email', '')) like '%@convertcake.com'
    ),
    false
  );
$$;

create or replace function moons.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists moons.clients (
  id text primary key,
  name text not null,
  category text not null,
  initials text not null,
  source text not null default 'manual',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists moons.brand_library (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references moons.clients(id) on delete cascade,
  section text not null check (section in ('brand', 'products', 'docs', 'refs')),
  title text not null,
  description text not null default '',
  asset_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists brand_library_client_section_idx
  on moons.brand_library (client_id, section, sort_order);

create table if not exists moons.brand_learning (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references moons.clients(id) on delete cascade,
  polarity text not null check (polarity in ('working', 'avoid')),
  note text not null,
  source_run_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists brand_learning_client_polarity_idx
  on moons.brand_learning (client_id, polarity, created_at desc);

create table if not exists moons.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  schema_version integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_owner_user_id_key unique (owner_user_id)
);

create table if not exists moons.runs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  client_id text references moons.clients(id) on delete set null,
  stage text not null,
  service text not null,
  quantity integer not null check (quantity between 1 and 6),
  brief text not null default '',
  is_pitching boolean not null default false,
  pitching_save_name text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists runs_owner_updated_idx
  on moons.runs (owner_user_id, updated_at desc);

create table if not exists moons.outputs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references moons.runs(id) on delete cascade,
  direction_id text not null,
  format text not null,
  status text not null,
  client_status text not null,
  revision_count integer not null default 0 check (revision_count >= 0),
  asset_url text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists outputs_run_idx on moons.outputs (run_id);

create table if not exists moons.activity_log (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete set null,
  run_id uuid references moons.runs(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_log_run_created_idx
  on moons.activity_log (run_id, created_at desc);

drop trigger if exists clients_set_updated_at on moons.clients;
create trigger clients_set_updated_at
  before update on moons.clients
  for each row execute function moons.set_updated_at();

drop trigger if exists brand_library_set_updated_at on moons.brand_library;
create trigger brand_library_set_updated_at
  before update on moons.brand_library
  for each row execute function moons.set_updated_at();

drop trigger if exists workspaces_set_updated_at on moons.workspaces;
create trigger workspaces_set_updated_at
  before update on moons.workspaces
  for each row execute function moons.set_updated_at();

drop trigger if exists runs_set_updated_at on moons.runs;
create trigger runs_set_updated_at
  before update on moons.runs
  for each row execute function moons.set_updated_at();

drop trigger if exists outputs_set_updated_at on moons.outputs;
create trigger outputs_set_updated_at
  before update on moons.outputs
  for each row execute function moons.set_updated_at();

grant select on moons.clients to authenticated;
grant select on moons.brand_library to authenticated;
grant select on moons.brand_learning to authenticated;
grant select, insert, update, delete on moons.workspaces to authenticated;
grant select, insert, update, delete on moons.runs to authenticated;
grant select, insert, update, delete on moons.outputs to authenticated;
grant select, insert on moons.activity_log to authenticated;

alter table moons.clients enable row level security;
alter table moons.brand_library enable row level security;
alter table moons.brand_learning enable row level security;
alter table moons.workspaces enable row level security;
alter table moons.runs enable row level security;
alter table moons.outputs enable row level security;
alter table moons.activity_log enable row level security;

create policy "convert cake users can read clients"
  on moons.clients for select
  using (moons.is_convert_cake_user());

create policy "convert cake users can read brand library"
  on moons.brand_library for select
  using (moons.is_convert_cake_user());

create policy "convert cake users can read brand learning"
  on moons.brand_learning for select
  using (moons.is_convert_cake_user());

create policy "users can read their workspace"
  on moons.workspaces for select
  using (moons.is_convert_cake_user() and owner_user_id = auth.uid());

create policy "users can insert their workspace"
  on moons.workspaces for insert
  with check (moons.is_convert_cake_user() and owner_user_id = auth.uid());

create policy "users can update their workspace"
  on moons.workspaces for update
  using (moons.is_convert_cake_user() and owner_user_id = auth.uid())
  with check (moons.is_convert_cake_user() and owner_user_id = auth.uid());

create policy "users can delete their workspace"
  on moons.workspaces for delete
  using (moons.is_convert_cake_user() and owner_user_id = auth.uid());

create policy "users can read their runs"
  on moons.runs for select
  using (moons.is_convert_cake_user() and owner_user_id = auth.uid());

create policy "users can write their runs"
  on moons.runs for all
  using (moons.is_convert_cake_user() and owner_user_id = auth.uid())
  with check (moons.is_convert_cake_user() and owner_user_id = auth.uid());

create policy "users can read outputs for their runs"
  on moons.outputs for select
  using (
    moons.is_convert_cake_user()
    and exists (
      select 1 from moons.runs
      where runs.id = outputs.run_id
      and runs.owner_user_id = auth.uid()
    )
  );

create policy "users can write outputs for their runs"
  on moons.outputs for all
  using (
    moons.is_convert_cake_user()
    and exists (
      select 1 from moons.runs
      where runs.id = outputs.run_id
      and runs.owner_user_id = auth.uid()
    )
  )
  with check (
    moons.is_convert_cake_user()
    and exists (
      select 1 from moons.runs
      where runs.id = outputs.run_id
      and runs.owner_user_id = auth.uid()
    )
  );

create policy "users can read their activity"
  on moons.activity_log for select
  using (moons.is_convert_cake_user() and owner_user_id = auth.uid());

create policy "users can insert their activity"
  on moons.activity_log for insert
  with check (moons.is_convert_cake_user() and owner_user_id = auth.uid());
