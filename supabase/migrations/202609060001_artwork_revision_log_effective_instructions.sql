alter table moons.artwork_revision_log
  add column if not exists effective_instructions text;
