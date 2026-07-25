create table if not exists moons.google_workspace_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_refresh_token text not null,
  updated_at timestamptz not null default now()
);

alter table moons.google_workspace_credentials enable row level security;

revoke all
  on table moons.google_workspace_credentials
  from anon, authenticated;

grant select, insert, update, delete
  on table moons.google_workspace_credentials
  to service_role;
