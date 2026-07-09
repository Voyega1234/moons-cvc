grant select, insert, update, delete on moons.brand_library to authenticated;

drop policy if exists "convert cake users can manage brand library"
  on moons.brand_library;

create policy "convert cake users can manage brand library"
  on moons.brand_library for all
  using (moons.is_convert_cake_user())
  with check (moons.is_convert_cake_user());
