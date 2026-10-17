begin;

-- Bind access to the verified account ID, never an editable display name.
create or replace function moons.can_access_private_client(target_client_id text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select target_client_id is null
    or target_client_id not in ('dos-life-d8eded63', 'fixfit-7f57de77')
    or coalesce(auth.uid() = '4e919caf-2e01-4efc-9ae8-bf70b2d92e3b'::uuid, false);
$$;

create or replace function moons.can_view_client(target_client_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select moons.is_convert_cake_user()
    and target_client_id is not null
    and case
      when target_client_id in ('dos-life-d8eded63', 'fixfit-7f57de77')
        then moons.can_access_private_client(target_client_id)
      else (
        not exists (
          select 1 from moons.client_memberships where client_id = target_client_id
        )
        or exists (
          select 1 from moons.client_memberships
          where client_id = target_client_id and user_id = auth.uid()
        )
        or moons.is_neo_admin()
      )
    end;
$$;

create or replace function moons.can_access_private_run(target_run_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select moons.can_access_private_client(client_id)
    from moons.runs where id = target_run_id
  ), true);
$$;

revoke all on function moons.can_access_private_client(text) from public;
revoke all on function moons.can_access_private_run(uuid) from public;
grant execute on function moons.can_access_private_client(text) to authenticated, service_role;
grant execute on function moons.can_access_private_run(uuid) to authenticated, service_role;

-- Restrictive policies also constrain existing permissive owner/admin policies.
drop policy if exists "private client access" on moons.clients;
create policy "private client access" on moons.clients
  as restrictive for all to authenticated
  using (moons.can_access_private_client(id))
  with check (moons.can_access_private_client(id));

do $$
declare
  target record;
  predicate text;
begin
  for target in
    select columns.table_name, columns.column_name
    from information_schema.columns
    join pg_catalog.pg_class relations
      on relations.relname = columns.table_name
      and relations.relnamespace = 'moons'::regnamespace
    where columns.table_schema = 'moons'
      and columns.column_name in ('client_id', 'run_id')
      and relations.relkind in ('r', 'p')
  loop
    predicate := case target.column_name
      when 'client_id' then 'moons.can_access_private_client(client_id)'
      else 'moons.can_access_private_run(run_id)'
    end;
    execute format(
      'drop policy if exists %I on moons.%I',
      'private ' || target.column_name || ' access', target.table_name
    );
    execute format(
      'create policy %I on moons.%I as restrictive for all to authenticated using (%s) with check (%s)',
      'private ' || target.column_name || ' access', target.table_name, predicate, predicate
    );
  end loop;
end;
$$;

-- Public object URLs remain public; restrict authenticated listing/signing/writes.
drop policy if exists "private client storage access" on storage.objects;
create policy "private client storage access" on storage.objects
  as restrictive for all to authenticated
  using (moons.can_access_private_client(split_part(name, '/', 1)))
  with check (moons.can_access_private_client(split_part(name, '/', 1)));

-- SECURITY DEFINER handoff/recovery functions must obey the same restriction.
create or replace function moons.guard_private_run_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.role() = 'authenticated'
    and new.client_id in ('dos-life-d8eded63', 'fixfit-7f57de77')
    and (
      not moons.can_access_private_client(new.client_id)
      or new.current_owner_user_id <> '4e919caf-2e01-4efc-9ae8-bf70b2d92e3b'::uuid
    ) then
    raise exception 'This client is private to Wave.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_private_run_owner on moons.runs;
create trigger guard_private_run_owner
  before insert or update on moons.runs
  for each row execute function moons.guard_private_run_owner();

commit;
