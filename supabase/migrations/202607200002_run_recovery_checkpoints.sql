create table if not exists moons.run_checkpoints (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references moons.runs(id) on delete cascade,
  reason text not null check (reason in ('regenerate', 'replace-image', 'send-to-qc')),
  snapshot jsonb not null,
  source_version integer not null check (source_version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists run_checkpoints_run_created_idx
  on moons.run_checkpoints (run_id, created_at desc);

create or replace function moons.keep_three_run_checkpoints()
returns trigger
language plpgsql
security definer
set search_path = moons, auth, public
as $$
begin
  delete from moons.run_checkpoints
  where id in (
    select id
    from moons.run_checkpoints
    where run_id = new.run_id
    order by created_at desc, id desc
    offset 3
  );
  return new;
end;
$$;

drop trigger if exists keep_three_run_checkpoints
  on moons.run_checkpoints;
create trigger keep_three_run_checkpoints
after insert on moons.run_checkpoints
for each row execute function moons.keep_three_run_checkpoints();

grant select, insert, delete on moons.run_checkpoints to authenticated;

alter table moons.run_checkpoints enable row level security;

drop policy if exists "client members can read run checkpoints"
  on moons.run_checkpoints;
create policy "client members can read run checkpoints"
  on moons.run_checkpoints for select
  using (
    moons.is_convert_cake_user()
    and exists (
      select 1
      from moons.runs
      where runs.id = run_checkpoints.run_id
        and (
          runs.current_owner_user_id = auth.uid()
          or moons.can_view_client(runs.client_id)
        )
    )
  );

drop policy if exists "current owners can create run checkpoints"
  on moons.run_checkpoints;
create policy "current owners can create run checkpoints"
  on moons.run_checkpoints for insert
  with check (
    moons.is_convert_cake_user()
    and created_by = auth.uid()
    and exists (
      select 1
      from moons.runs
      where runs.id = run_checkpoints.run_id
        and runs.current_owner_user_id = auth.uid()
    )
  );

drop policy if exists "current owners can delete run checkpoints"
  on moons.run_checkpoints;
create policy "current owners can delete run checkpoints"
  on moons.run_checkpoints for delete
  using (
    moons.is_convert_cake_user()
    and exists (
      select 1
      from moons.runs
      where runs.id = run_checkpoints.run_id
        and runs.current_owner_user_id = auth.uid()
    )
  );

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
  restored_run jsonb;
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

  restored_run := checkpoint_record.snapshot
    -> 'data'
    -> 'runsById'
    -> current_run.workspace_run_id;

  if restored_run is null then
    raise exception 'Recovery point is invalid' using errcode = '22023';
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
