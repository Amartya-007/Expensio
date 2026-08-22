create schema if not exists tests;

create or replace function tests.create_user(
  p_id uuid,
  p_email text,
  p_phone text default null,
  p_is_anonymous boolean default false
) returns void language plpgsql as $$
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
