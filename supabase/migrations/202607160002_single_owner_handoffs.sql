create table if not exists moons.team_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null,
  department text not null default 'unassigned'
    check (department in ('cs', 'gd', 'pm', 'admin', 'unassigned')),
  is_admin boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function moons.sync_team_profile()
returns trigger
language plpgsql
security definer
set search_path = moons, auth, public
as $$
begin
  insert into moons.team_profiles (
    user_id,
    email,
    display_name,
    department,
    is_admin
  ) values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      split_part(coalesce(new.email, 'Neo user'), '@', 1)
    ),
    case
      when new.raw_app_meta_data ->> 'department' in ('cs', 'gd', 'pm', 'admin')
        then new.raw_app_meta_data ->> 'department'
      else 'unassigned'
    end,
    coalesce(new.raw_app_meta_data ->> 'role', '') = 'admin'
  )
  on conflict (user_id) do update set
    email = excluded.email,
    display_name = excluded.display_name,
    department = excluded.department,
    is_admin = excluded.is_admin,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists auth_user_sync_neo_profile on auth.users;
create trigger auth_user_sync_neo_profile
  after insert or update of email, raw_user_meta_data, raw_app_meta_data
  on auth.users
  for each row execute function moons.sync_team_profile();

insert into moons.team_profiles (
  user_id,
  email,
  display_name,
  department,
  is_admin
)
select
  users.id,
  coalesce(users.email, ''),
  coalesce(
    nullif(users.raw_user_meta_data ->> 'display_name', ''),
    nullif(users.raw_user_meta_data ->> 'full_name', ''),
    split_part(coalesce(users.email, 'Neo user'), '@', 1)
  ),
  case
    when users.raw_app_meta_data ->> 'department' in ('cs', 'gd', 'pm', 'admin')
      then users.raw_app_meta_data ->> 'department'
    else 'unassigned'
  end,
  coalesce(users.raw_app_meta_data ->> 'role', '') = 'admin'
from auth.users as users
where users.email is not null
on conflict (user_id) do nothing;

create table if not exists moons.client_memberships (
  client_id text not null references moons.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member'
    check (role in ('member', 'lead', 'admin')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (client_id, user_id)
);

create or replace function moons.is_neo_admin()
returns boolean
language sql
stable
security definer
set search_path = moons, auth, public
as $$
  select exists (
    select 1
    from moons.team_profiles
    where user_id = auth.uid()
      and is_active
      and is_admin
  );
$$;

create or replace function moons.can_view_client(target_client_id text)
returns boolean
language sql
stable
security definer
set search_path = moons, auth, public
as $$
  select
    moons.is_convert_cake_user()
    and target_client_id is not null
    and (
      not exists (
        select 1
        from moons.client_memberships
        where client_id = target_client_id
      )
      or exists (
        select 1
        from moons.client_memberships
        where client_id = target_client_id
          and user_id = auth.uid()
      )
      or moons.is_neo_admin()
    );
$$;

alter table moons.runs
  add column if not exists workspace_run_id text,
  add column if not exists snapshot jsonb,
  add column if not exists current_owner_user_id uuid references auth.users(id) on delete restrict,
  add column if not exists status text not null default 'active'
    check (status in ('active', 'completed', 'archived')),
  add column if not exists version integer not null default 1 check (version > 0),
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists completed_at timestamptz;

alter table moons.runs
  drop constraint if exists runs_quantity_check;
alter table moons.runs
  add constraint runs_quantity_check check (quantity between 1 and 100);

update moons.runs
set current_owner_user_id = owner_user_id
where current_owner_user_id is null;

alter table moons.runs
  alter column current_owner_user_id set not null;

create unique index if not exists runs_workspace_run_id_key
  on moons.runs (workspace_run_id)
  where workspace_run_id is not null;

create index if not exists runs_current_owner_updated_idx
  on moons.runs (current_owner_user_id, updated_at desc);

create table if not exists moons.run_handoffs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references moons.runs(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete restrict,
  to_user_id uuid not null references auth.users(id) on delete restrict,
  from_department text not null,
  to_department text not null,
  note text,
  version integer not null check (version > 1),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists run_handoffs_run_created_idx
  on moons.run_handoffs (run_id, created_at desc);

grant usage on schema moons to authenticated;
grant select on moons.team_profiles to authenticated;
grant select on moons.client_memberships to authenticated;
grant select, insert, update, delete on moons.client_memberships to authenticated;
grant select, insert, update, delete on moons.runs to authenticated;
grant select on moons.run_handoffs to authenticated;

alter table moons.team_profiles enable row level security;
alter table moons.client_memberships enable row level security;
alter table moons.run_handoffs enable row level security;

drop policy if exists "convert cake users can read team profiles"
  on moons.team_profiles;
create policy "convert cake users can read team profiles"
  on moons.team_profiles for select
  using (moons.is_convert_cake_user());

drop policy if exists "client members can read memberships"
  on moons.client_memberships;
create policy "client members can read memberships"
  on moons.client_memberships for select
  using (
    moons.is_convert_cake_user()
    and (user_id = auth.uid() or moons.is_neo_admin())
  );

drop policy if exists "admins can manage memberships"
  on moons.client_memberships;
create policy "admins can manage memberships"
  on moons.client_memberships for all
  using (moons.is_neo_admin())
  with check (moons.is_neo_admin());

drop policy if exists "users can read their runs" on moons.runs;
drop policy if exists "users can write their runs" on moons.runs;
drop policy if exists "client members can read runs" on moons.runs;
drop policy if exists "users can create owned runs" on moons.runs;
drop policy if exists "current owners can update runs" on moons.runs;
drop policy if exists "current owners can archive runs" on moons.runs;

create policy "client members can read runs"
  on moons.runs for select
  using (
    moons.is_convert_cake_user()
    and (
      current_owner_user_id = auth.uid()
      or moons.can_view_client(client_id)
    )
  );

create policy "users can create owned runs"
  on moons.runs for insert
  with check (
    moons.is_convert_cake_user()
    and owner_user_id = auth.uid()
    and current_owner_user_id = auth.uid()
    and (client_id is null or moons.can_view_client(client_id))
  );

create policy "current owners can update runs"
  on moons.runs for update
  using (
    moons.is_convert_cake_user()
    and current_owner_user_id = auth.uid()
  )
  with check (
    moons.is_convert_cake_user()
    and current_owner_user_id = auth.uid()
  );

create policy "current owners can archive runs"
  on moons.runs for delete
  using (
    moons.is_convert_cake_user()
    and current_owner_user_id = auth.uid()
  );

drop policy if exists "users can read outputs for their runs" on moons.outputs;
drop policy if exists "users can write outputs for their runs" on moons.outputs;
drop policy if exists "client members can read run outputs" on moons.outputs;
drop policy if exists "current owners can write run outputs" on moons.outputs;

create policy "client members can read run outputs"
  on moons.outputs for select
  using (
    moons.is_convert_cake_user()
    and exists (
      select 1
      from moons.runs
      where runs.id = outputs.run_id
        and (
          runs.current_owner_user_id = auth.uid()
          or moons.can_view_client(runs.client_id)
        )
    )
  );

create policy "current owners can write run outputs"
  on moons.outputs for all
  using (
    moons.is_convert_cake_user()
    and exists (
      select 1 from moons.runs
      where runs.id = outputs.run_id
        and runs.current_owner_user_id = auth.uid()
    )
  )
  with check (
    moons.is_convert_cake_user()
    and exists (
      select 1 from moons.runs
      where runs.id = outputs.run_id
        and runs.current_owner_user_id = auth.uid()
    )
  );

drop policy if exists "client members can read handoff history"
  on moons.run_handoffs;
create policy "client members can read handoff history"
  on moons.run_handoffs for select
  using (
    moons.is_convert_cake_user()
    and exists (
      select 1
      from moons.runs
      where runs.id = run_handoffs.run_id
        and (
          runs.current_owner_user_id = auth.uid()
          or moons.can_view_client(runs.client_id)
        )
    )
  );

create or replace function moons.handoff_run(
  p_workspace_run_id text,
  p_to_user_id uuid,
  p_expected_version integer,
  p_note text default null
)
returns table (
  workspace_run_id text,
  current_owner_user_id uuid,
  version integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = moons, auth, public
as $$
declare
  actor_id uuid := auth.uid();
  current_run moons.runs%rowtype;
  from_department text;
  to_department text;
begin
  if actor_id is null or not moons.is_convert_cake_user() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select * into current_run
  from moons.runs
  where runs.workspace_run_id = p_workspace_run_id
  for update;

  if not found then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;

  if current_run.current_owner_user_id <> actor_id and not moons.is_neo_admin() then
    raise exception 'Only the current owner can hand off this project'
      using errcode = '42501';
  end if;

  if current_run.version <> p_expected_version then
    raise exception 'This project changed in another browser. Reload and try again.'
      using errcode = '40001';
  end if;

  if p_to_user_id = current_run.current_owner_user_id then
    raise exception 'Choose a different owner' using errcode = '22023';
  end if;

  select department into from_department
  from moons.team_profiles
  where user_id = current_run.current_owner_user_id;

  select department into to_department
  from moons.team_profiles
  where user_id = p_to_user_id
    and is_active;

  if to_department is null then
    raise exception 'The selected team member is not active'
      using errcode = '22023';
  end if;

  if current_run.client_id is not null
    and exists (
      select 1
      from moons.client_memberships
      where client_id = current_run.client_id
    )
    and not exists (
      select 1
      from moons.client_memberships
      where client_id = current_run.client_id
        and user_id = p_to_user_id
    )
    and not exists (
      select 1 from moons.team_profiles
      where user_id = p_to_user_id and is_admin
    ) then
    raise exception 'The selected user is not assigned to this client'
      using errcode = '42501';
  end if;

  update moons.runs
  set
    current_owner_user_id = p_to_user_id,
    version = current_run.version + 1,
    updated_by = actor_id,
    updated_at = now()
  where id = current_run.id;

  insert into moons.run_handoffs (
    run_id,
    from_user_id,
    to_user_id,
    from_department,
    to_department,
    note,
    version,
    created_by
  ) values (
    current_run.id,
    current_run.current_owner_user_id,
    p_to_user_id,
    coalesce(from_department, 'unassigned'),
    to_department,
    nullif(trim(p_note), ''),
    current_run.version + 1,
    actor_id
  );

  return query
  select
    runs.workspace_run_id,
    runs.current_owner_user_id,
    runs.version,
    runs.updated_at
  from moons.runs
  where runs.id = current_run.id;
end;
$$;

revoke all on function moons.handoff_run(text, uuid, integer, text) from public;
grant execute on function moons.handoff_run(text, uuid, integer, text) to authenticated;
