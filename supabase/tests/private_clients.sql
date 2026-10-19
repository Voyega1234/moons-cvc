-- Run as postgres after 202610190001_private_you_turn.sql. Leaves no data changes.
begin;

create temporary table private_run_ids as
  select id from moons.runs
  where client_id in ('dos-life-d8eded63', 'fixfit-7f57de77', 'you-9135008f');
grant select on private_run_ids to authenticated;
create temporary table private_test_profiles as
  select user_id, email from moons.team_profiles;
grant select on private_test_profiles to authenticated;

set local role authenticated;

do $$
declare
  profile record;
  target record;
  private_run record;
  visible_count integer;
  expected_count integer;
begin
  if not exists (select 1 from private_test_profiles
    where user_id = '4e919caf-2e01-4efc-9ae8-bf70b2d92e3b'::uuid)
    or (select count(*) from private_test_profiles) < 2 then
    raise exception 'The access check requires Wave and another team account.';
  end if;
  for profile in select user_id, email from private_test_profiles loop
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', profile.user_id, 'email', profile.email, 'role', 'authenticated'
    )::text, true);

    expected_count := case
      when profile.user_id = '4e919caf-2e01-4efc-9ae8-bf70b2d92e3b'::uuid then 3
      else 0
    end;
    select count(*) into visible_count from moons.clients
      where id in ('dos-life-d8eded63', 'fixfit-7f57de77', 'you-9135008f');
    if visible_count <> expected_count then
      raise exception 'Client visibility failed for %: %', profile.email, visible_count;
    end if;
    if moons.can_view_client('dos-life-d8eded63') <> (expected_count = 3)
      or moons.can_view_client('fixfit-7f57de77') <> (expected_count = 3)
      or moons.can_view_client('you-9135008f') <> (expected_count = 3) then
      raise exception 'Client permission helper failed for %', profile.email;
    end if;
    if not moons.can_access_private_client('unrestricted-client')
      or not moons.can_access_private_client(null) then
      raise exception 'Unrelated clients were restricted for %', profile.email;
    end if;

    if expected_count = 0 then
      if exists (select 1 from storage.objects
        where split_part(name, '/', 1) in ('dos-life-d8eded63', 'fixfit-7f57de77', 'you-9135008f')) then
        raise exception 'Private storage paths exposed to %', profile.email;
      end if;
      for target in
        select tablename from pg_policies
        where schemaname = 'moons' and policyname = 'private client_id access'
      loop
        execute format(
          'select count(*) from moons.%I where client_id in (''dos-life-d8eded63'', ''fixfit-7f57de77'', ''you-9135008f'')',
          target.tablename
        ) into visible_count;
        if visible_count <> 0 then
          raise exception 'Private rows exposed in % to %', target.tablename, profile.email;
        end if;
      end loop;
      for target in
        select tablename from pg_policies
        where schemaname = 'moons' and policyname = 'private run_id access'
      loop
        execute format(
          'select count(*) from moons.%I where run_id in (select id from private_run_ids)',
          target.tablename
        ) into visible_count;
        if visible_count <> 0 then
          raise exception 'Private run rows exposed in % to %', target.tablename, profile.email;
        end if;
      end loop;
    end if;
  end loop;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '4e919caf-2e01-4efc-9ae8-bf70b2d92e3b',
    'email', 'wave@convertcake.com', 'role', 'authenticated'
  )::text, true);
  for private_run in select id from private_run_ids loop
    begin
      update moons.runs set current_owner_user_id = (
        select user_id from private_test_profiles
        where user_id <> '4e919caf-2e01-4efc-9ae8-bf70b2d92e3b'::uuid limit 1
      ) where id = private_run.id;
      raise exception 'Private run handoff was allowed.';
    exception when insufficient_privilege then
      null;
    end;
  end loop;
end;
$$;

reset role;
select 'PASS: Wave sees all three private clients; all other team accounts (including admins) see no private client or run rows.' as result;
rollback;
