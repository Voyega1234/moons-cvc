create or replace function moons.claim_next_brand_analysis_job()
returns table (
  job_id uuid,
  client_id text,
  client_name text,
  facebook_url text
)
language plpgsql
security definer
set search_path = moons, public
as $$
begin
  return query
  with next_job as (
    select job.id
    from moons.brand_analysis_jobs as job
    where job.status = 'queued'
    order by job.created_at asc
    for update of job skip locked
    limit 1
  ),
  claimed_job as (
    update moons.brand_analysis_jobs as job
    set
      status = 'validating_source',
      current_step = 'claimed',
      started_at = coalesce(job.started_at, now()),
      completed_at = null,
      error_message = null,
      updated_at = now()
    from next_job
    where job.id = next_job.id
    returning job.id, job.client_id
  ),
  claimed_client as (
    update moons.clients as client
    set
      ingestion_status = 'validating_source',
      ingestion_error = null,
      updated_at = now()
    from claimed_job
    where client.id = claimed_job.client_id
    returning client.id, client.name, client.facebook_url
  )
  select
    claimed_job.id as job_id,
    claimed_client.id as client_id,
    claimed_client.name as client_name,
    claimed_client.facebook_url as facebook_url
  from claimed_job
  join claimed_client on claimed_client.id = claimed_job.client_id;
end;
$$;

revoke all on function moons.claim_next_brand_analysis_job() from public;
grant execute on function moons.claim_next_brand_analysis_job() to service_role;
