grant insert on moons.brand_learning to authenticated;

drop policy if exists "convert cake users can add brand learning"
  on moons.brand_learning;

create policy "convert cake users can add brand learning"
  on moons.brand_learning for insert
  with check (moons.is_convert_cake_user());
