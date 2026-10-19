begin;

-- Extend the existing guards without changing their policies or other logic.
do $$
declare
  routine text;
  definition text;
  previous_clients constant text := '''dos-life-d8eded63'', ''fixfit-7f57de77''';
  private_clients constant text := '''dos-life-d8eded63'', ''fixfit-7f57de77'', ''you-9135008f''';
begin
  foreach routine in array array[
    'moons.can_access_private_client(text)',
    'moons.can_view_client(text)',
    'moons.guard_private_run_owner()'
  ] loop
    definition := pg_get_functiondef(routine::regprocedure);
    if strpos(definition, '''you-9135008f''') > 0 then
      continue;
    end if;
    if strpos(definition, previous_clients) = 0 then
      raise exception 'Private client guard changed: %', routine;
    end if;
    execute replace(definition, previous_clients, private_clients);
  end loop;
end;
$$;

commit;
