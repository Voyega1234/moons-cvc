create table if not exists moons.artwork_revision_log (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  client_id text,
  workspace_run_id text not null,
  direction_id text not null,
  output_id text not null,
  is_album boolean not null default false,
  affected_output_ids jsonb not null default '[]'::jsonb,
  instructions text not null,
  previous_asset_url text,
  new_asset_url text,
  created_at timestamptz not null default now()
);

create index if not exists artwork_revision_log_run_created_idx
  on moons.artwork_revision_log (workspace_run_id, created_at desc);

create index if not exists artwork_revision_log_owner_created_idx
  on moons.artwork_revision_log (owner_user_id, created_at desc);

grant select, insert on moons.artwork_revision_log to authenticated, service_role;

alter table moons.artwork_revision_log enable row level security;

drop policy if exists "users can read their artwork revision log"
  on moons.artwork_revision_log;
create policy "users can read their artwork revision log"
  on moons.artwork_revision_log for select
  using (
    moons.is_convert_cake_user()
    and owner_user_id = auth.uid()
  );

drop policy if exists "users can insert their artwork revision log"
  on moons.artwork_revision_log;
create policy "users can insert their artwork revision log"
  on moons.artwork_revision_log for insert
  with check (
    moons.is_convert_cake_user()
    and owner_user_id = auth.uid()
  );
