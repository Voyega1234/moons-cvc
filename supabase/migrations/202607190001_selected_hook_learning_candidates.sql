create table if not exists moons.selected_hook_learning_candidates (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references moons.clients(id) on delete cascade,
  workspace_run_id text not null,
  direction_id text not null,
  output_id text not null,
  service text not null,
  artwork_mode text not null,
  hook_text text not null,
  concept text not null default '',
  rationale text not null default '',
  visual_direction text not null default '',
  cta text not null default '',
  caption text not null default '',
  hook_payload jsonb not null default '{}'::jsonb,
  image_url text,
  asset_bucket text not null,
  asset_storage_path text not null,
  provider text,
  model text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  selected_at timestamptz not null default now(),
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint selected_hook_learning_candidates_brand_output_key
    unique (client_id, workspace_run_id, output_id)
);

create index if not exists selected_hook_learning_candidates_brand_created_idx
  on moons.selected_hook_learning_candidates (client_id, created_at desc);

create index if not exists selected_hook_learning_candidates_brand_direction_idx
  on moons.selected_hook_learning_candidates (
    client_id,
    workspace_run_id,
    direction_id
  );

drop trigger if exists selected_hook_learning_candidates_set_updated_at
  on moons.selected_hook_learning_candidates;
create trigger selected_hook_learning_candidates_set_updated_at
  before update on moons.selected_hook_learning_candidates
  for each row execute function moons.set_updated_at();

grant select, insert, update, delete
  on moons.selected_hook_learning_candidates
  to authenticated;

alter table moons.selected_hook_learning_candidates enable row level security;

drop policy if exists "convert cake users can read selected hook candidates"
  on moons.selected_hook_learning_candidates;
create policy "convert cake users can read selected hook candidates"
  on moons.selected_hook_learning_candidates for select
  using (moons.is_convert_cake_user());

drop policy if exists "convert cake users can insert selected hook candidates"
  on moons.selected_hook_learning_candidates;
create policy "convert cake users can insert selected hook candidates"
  on moons.selected_hook_learning_candidates for insert
  with check (moons.is_convert_cake_user());

drop policy if exists "convert cake users can update selected hook candidates"
  on moons.selected_hook_learning_candidates;
create policy "convert cake users can update selected hook candidates"
  on moons.selected_hook_learning_candidates for update
  using (moons.is_convert_cake_user())
  with check (moons.is_convert_cake_user());

drop policy if exists "convert cake users can delete selected hook candidates"
  on moons.selected_hook_learning_candidates;
create policy "convert cake users can delete selected hook candidates"
  on moons.selected_hook_learning_candidates for delete
  using (moons.is_convert_cake_user());
