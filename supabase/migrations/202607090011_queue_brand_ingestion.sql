create or replace function moons.queue_brand_analysis(
  p_client_id text,
  p_facebook_url text
)
returns uuid
language plpgsql
security invoker
set search_path = moons, public
as $$
declare
  next_job_id uuid;
  current_status text;
begin
  if not moons.is_convert_cake_user() then
    raise exception 'Not authorized.';
  end if;

  if trim(coalesce(p_facebook_url, '')) !~
    '^https?://(www\.)?(facebook\.com|fb\.com)/'
  then
    raise exception 'Enter a valid Facebook page URL.';
  end if;

  select ingestion_status
  into current_status
  from moons.clients
  where id = p_client_id
    and is_active = true
  for update;

  if not found then
    raise exception 'Client not found.';
  end if;

  if current_status not in ('not_started', 'draft', 'failed') then
    raise exception 'Client ingestion is already queued or completed.';
  end if;

  if exists (
    select 1
    from moons.brand_analysis_jobs
    where client_id = p_client_id
      and status not in ('ready', 'needs_review', 'failed')
  ) then
    raise exception 'Client ingestion is already queued.';
  end if;

  update moons.clients
  set
    facebook_url = trim(p_facebook_url),
    ingestion_status = 'queued',
    ingestion_error = null
  where id = p_client_id;

  insert into moons.brand_analysis_jobs (
    client_id,
    status,
    current_step,
    source_status,
    created_by
  )
  values (
    p_client_id,
    'queued',
    'queued',
    '{}'::jsonb,
    auth.uid()
  )
  returning id into next_job_id;

  return next_job_id;
end;
$$;

revoke all on function moons.queue_brand_analysis(text, text) from public;
grant execute on function moons.queue_brand_analysis(text, text)
  to authenticated;
