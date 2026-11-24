-- Lets the backend label-backfill script (service role) read and update brand assets.
grant select, update on moons.brand_assets to service_role;
