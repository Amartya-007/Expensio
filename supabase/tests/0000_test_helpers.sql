create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

-- security definer, not invoker (the previous default): a real end-user connection is
-- always Postgres role "authenticated" (or "anon") in Supabase, never a superuser or the
-- table owner -- that's precisely what makes RLS apply to it at all. Without this, the
-- only way this whole suite's RLS assertions ("an outsider cannot read another trip",
-- etc.) could ever run was as postgres/superuser, which silently bypasses row-level
-- security altogether regardless of what any policy says -- so those assertions were
-- passing or failing on artifacts of the test session's privilege level, not on whether
-- RLS actually works. This function needs to write directly to auth.users no matter which
-- role calls it, exactly like Supabase's own supabase_test_helpers extension does it.
-- Found by actually running this suite as role authenticated, not by reading it.
create or replace function tests.create_user(
  p_id uuid,
  p_email text,
  p_phone text default null,
  p_is_anonymous boolean default false
) returns void language plpgsql security definer set search_path = public, auth as $$
begin
  insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, is_anonymous, phone, phone_confirmed_at,
    created_at, updated_at
  ) values (
    p_id, 'authenticated', 'authenticated', p_email, '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    p_is_anonymous, p_phone, case when p_phone is null then null else now() end,
    now(), now()
  ) on conflict (id) do nothing;
end; $$;

create or replace function tests.as_user(
  p_id uuid,
  p_is_anonymous boolean default false,
  p_phone text default null
) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_id::text,
      'role', 'authenticated',
      'is_anonymous', p_is_anonymous,
      'phone', p_phone
    )::text,
    true
  );
end; $$;

create or replace function tests.clear_user() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claims', '{}', true);
end; $$;
