create or replace function moons.restore_run_checkpoint(
  p_checkpoint_id uuid,
  p_workspace_run_id text,
  p_expected_version integer
)
returns table (
  workspace_run_id text,
  current_owner_user_id uuid,
  version integer,
  snapshot jsonb,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = moons, auth, public
as $$
declare
  actor_id uuid := auth.uid();
  checkpoint_record moons.run_checkpoints%rowtype;
  current_run moons.runs%rowtype;
  current_run_state jsonb;
  restored_run jsonb;
  current_brand_id text;
  restored_brand_id text;
begin
  if actor_id is null or not moons.is_convert_cake_user() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select * into checkpoint_record
  from moons.run_checkpoints
  where id = p_checkpoint_id;

  if not found then
    raise exception 'Recovery point not found' using errcode = 'P0002';
  end if;

  select * into current_run
  from moons.runs
  where id = checkpoint_record.run_id
  for update;

  if current_run.current_owner_user_id <> actor_id
    and not moons.is_neo_admin() then
    raise exception 'Only the current owner can restore this project'
      using errcode = '42501';
  end if;

  if current_run.workspace_run_id <> p_workspace_run_id then
    raise exception 'Recovery point does not belong to this project'
      using errcode = '22023';
  end if;

  if current_run.version <> p_expected_version then
    raise exception 'This project changed in another browser. Reload and try again.'
      using errcode = '40001';
  end if;

  current_run_state := current_run.snapshot
    -> 'data'
    -> 'runsById'
    -> current_run.workspace_run_id;
  restored_run := checkpoint_record.snapshot
    -> 'data'
    -> 'runsById'
    -> current_run.workspace_run_id;

  if restored_run is null then
    raise exception 'Recovery point is invalid' using errcode = '22023';
  end if;

  current_brand_id := coalesce(
    nullif(trim(current_run_state -> 'brand' ->> 'id'), ''),
    current_run.client_id::text
  );
  restored_brand_id := nullif(
    trim(restored_run -> 'brand' ->> 'id'),
    ''
  );

  if restored_brand_id is distinct from current_brand_id then
    raise exception
      'This recovery point belongs to a different client and cannot be restored here.'
      using errcode = '22023';
  end if;

  update moons.runs
  set snapshot = checkpoint_record.snapshot,
      stage = coalesce(restored_run ->> 'stage', current_run.stage),
      service = coalesce(restored_run ->> 'service', current_run.service),
      quantity = coalesce((restored_run ->> 'quantity')::integer, current_run.quantity),
      brief = coalesce(restored_run ->> 'brief', current_run.brief),
      status = case
        when coalesce((restored_run ->> 'done')::boolean, false)
          then 'completed'
        else 'active'
      end,
      completed_at = case
        when coalesce((restored_run ->> 'done')::boolean, false)
          then now()
        else null
      end,
      version = current_run.version + 1,
      updated_by = actor_id,
      updated_at = now()
  where id = current_run.id;

  return query
  select
    runs.workspace_run_id,
    runs.current_owner_user_id,
    runs.version,
    runs.snapshot,
    runs.updated_at
  from moons.runs
  where runs.id = current_run.id;
end;
$$;

revoke all on function moons.restore_run_checkpoint(uuid, text, integer)
  from public;
grant execute on function moons.restore_run_checkpoint(uuid, text, integer)
  to authenticated;
