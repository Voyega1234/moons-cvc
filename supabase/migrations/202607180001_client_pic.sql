drop policy if exists "client members can read memberships"
  on moons.client_memberships;
drop policy if exists "convert cake users can read memberships"
  on moons.client_memberships;
create policy "convert cake users can read memberships"
  on moons.client_memberships for select
  using (moons.is_convert_cake_user());

with ranked_leads as (
  select
    client_id,
    user_id,
    row_number() over (
      partition by client_id
      order by created_at, user_id
    ) as lead_rank
  from moons.client_memberships
  where role = 'lead'
)
update moons.client_memberships membership
   set role = 'member'
  from ranked_leads
 where membership.client_id = ranked_leads.client_id
   and membership.user_id = ranked_leads.user_id
   and ranked_leads.lead_rank > 1;

create unique index if not exists client_memberships_one_lead_per_client
  on moons.client_memberships (client_id)
  where role = 'lead';

create or replace function moons.set_client_pic(
  p_client_id text,
  p_user_id uuid
)
returns table (
  client_id text,
  user_id uuid,
  role text
)
language plpgsql
security definer
set search_path = moons, public
as $$
declare
  actor_user_id uuid := auth.uid();
begin
  if actor_user_id is null or not moons.is_convert_cake_user() then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if not moons.is_neo_admin() then
    raise exception 'Only an admin can assign a client PIC.' using errcode = '42501';
  end if;

  if p_client_id is null or btrim(p_client_id) = '' then
    raise exception 'Client is required.' using errcode = '22023';
  end if;

  if not exists (
    select 1
      from moons.team_profiles profile
     where profile.user_id = p_user_id
       and profile.is_active = true
  ) then
    raise exception 'PIC must be an active team member.' using errcode = '22023';
  end if;

  update moons.client_memberships membership
     set role = 'member'
   where membership.client_id = p_client_id
     and membership.role = 'lead'
     and membership.user_id <> p_user_id;

  insert into moons.client_memberships (
    client_id,
    user_id,
    role,
    created_by
  ) values (
    p_client_id,
    p_user_id,
    'lead',
    actor_user_id
  )
  on conflict (client_id, user_id)
  do update set role = excluded.role;

  return query
    select membership.client_id, membership.user_id, membership.role
      from moons.client_memberships membership
     where membership.client_id = p_client_id
       and membership.user_id = p_user_id;
end;
$$;

revoke all on function moons.set_client_pic(text, uuid) from public;
grant execute on function moons.set_client_pic(text, uuid) to authenticated;
