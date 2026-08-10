create table if not exists moons.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  client_id text,
  workspace_run_id text,
  request_group_id uuid not null,
  sequence_no integer not null check (sequence_no > 0),
  operation text not null,
  stage text not null,
  modality text not null check (modality in ('text', 'image')),
  provider text not null,
  model text not null,
  endpoint text not null,
  provider_request_id text,
  http_status integer not null,
  status text not null check (status in ('succeeded', 'failed')),
  duration_ms integer not null check (duration_ms >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  cached_input_tokens bigint not null default 0 check (cached_input_tokens >= 0),
  cache_write_tokens bigint not null default 0 check (cache_write_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  reasoning_tokens bigint not null default 0 check (reasoning_tokens >= 0),
  input_text_tokens bigint not null default 0 check (input_text_tokens >= 0),
  input_image_tokens bigint not null default 0 check (input_image_tokens >= 0),
  output_image_tokens bigint not null default 0 check (output_image_tokens >= 0),
  total_tokens bigint not null default 0 check (total_tokens >= 0),
  web_search_requests integer not null default 0 check (web_search_requests >= 0),
  image_count integer not null default 0 check (image_count >= 0),
  image_size text,
  image_quality text,
  provider_reported_cost_usd numeric,
  raw_usage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ai_usage_events_request_sequence_key
    unique (request_group_id, sequence_no)
);

create index if not exists ai_usage_events_owner_created_idx
  on moons.ai_usage_events (owner_user_id, created_at desc);

create index if not exists ai_usage_events_client_created_idx
  on moons.ai_usage_events (client_id, created_at desc);

create index if not exists ai_usage_events_workspace_run_created_idx
  on moons.ai_usage_events (workspace_run_id, created_at desc);

grant select, insert on moons.ai_usage_events to authenticated, service_role;

alter table moons.ai_usage_events enable row level security;

drop policy if exists "users can read their AI usage events"
  on moons.ai_usage_events;
create policy "users can read their AI usage events"
  on moons.ai_usage_events for select
  using (
    moons.is_convert_cake_user()
    and owner_user_id = auth.uid()
  );

drop policy if exists "users can insert their AI usage events"
  on moons.ai_usage_events;
create policy "users can insert their AI usage events"
  on moons.ai_usage_events for insert
  with check (
    moons.is_convert_cake_user()
    and owner_user_id = auth.uid()
  );
