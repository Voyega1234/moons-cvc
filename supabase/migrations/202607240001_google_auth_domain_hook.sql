create or replace function moons.is_convert_cake_user()
returns boolean
language sql
stable
as $$
  select coalesce(
    auth.role() = 'authenticated'
    and lower(trim(coalesce(auth.jwt() ->> 'email', '')))
      ~ '^[^@[:space:]]+@convertcake[.]com$',
    false
  );
$$;

create or replace function public.hook_restrict_creative_compass_signup(event jsonb)
returns jsonb
language plpgsql
as $$
declare
  account_email text := lower(trim(coalesce(event->'user'->>'email', '')));
  account_provider text := lower(
    trim(coalesce(event->'user'->'app_metadata'->>'provider', ''))
  );
begin
  if account_provider <> 'google' then
    return jsonb_build_object(
      'error',
      jsonb_build_object(
        'http_code', 403,
        'message', 'Sign in with your Convert Cake Google account.'
      )
    );
  end if;

  if account_email !~ '^[^@[:space:]]+@convertcake[.]com$' then
    return jsonb_build_object(
      'error',
      jsonb_build_object(
        'http_code', 403,
        'message', 'Creative Compass is available only to @convertcake.com accounts.'
      )
    );
  end if;

  return '{}'::jsonb;
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute
  on function public.hook_restrict_creative_compass_signup(jsonb)
  to supabase_auth_admin;
revoke execute
  on function public.hook_restrict_creative_compass_signup(jsonb)
  from authenticated, anon, public;
