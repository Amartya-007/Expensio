begin;
select plan(15);

select tests.create_user('10000000-0000-0000-0000-000000000011', 'rpc-owner@example.test');
select tests.create_user('10000000-0000-0000-0000-000000000012', 'rpc-outsider@example.test');
select tests.as_user('10000000-0000-0000-0000-000000000011', false);

select lives_ok(
  $$select create_trip('RPC trip', 'INR', '{}', '50000000-0000-0000-0000-000000000001')$$,
  'create_trip succeeds for an authenticated user'
);
select is(
  (select count(*) from processed_requests where client_request_id = '50000000-0000-0000-0000-000000000001'),
  1::bigint,
  'create_trip claims one idempotency key'
);
select is(
  (select count(*) from trip_activity_log where event_type = 'trip_created'),
  1::bigint,
  'create_trip writes an activity event'
);

select tests.as_user('10000000-0000-0000-0000-000000000011', false);
select lives_ok(
  $$select add_placeholder_participant(
    (select id from trips where name = 'RPC trip'),
    'Guest', null, '50000000-0000-0000-0000-000000000002'
  )$$,
  'active member can add a placeholder'
);
select lives_ok(
  $$select add_expense(
    (select id from trips where name = 'RPC trip'),
    (select id from participants where linked_user_id = '10000000-0000-0000-0000-000000000011'),
    'Meal', 100, 'INR', 'equal', '{}', null, '50000000-0000-0000-0000-000000000003'
  )$$,
  'active member can add an expense'
);
select lives_ok(
  $$select edit_expense(
    (select id from expenses where description = 'Meal'),
    'Meal updated', 120, 'equal', '{}', '50000000-0000-0000-0000-000000000004'
  )$$,
  'active member can edit an expense'
);
select is(
  (select balance_delta from trip_balances
   where trip_id = (select id from trips where name = 'RPC trip')
     and participant_id = (select id from participants where linked_user_id = '10000000-0000-0000-0000-000000000011')
     and currency = 'INR'),
  60::numeric,
  'editing an expense leaves only the current expense balance'
);
select is(
  (select coalesce(sum(balance_delta), 0) from trip_balances
   where trip_id = (select id from trips where name = 'RPC trip') and currency = 'INR'),
  0::numeric,
  'expense balances remain zero-sum after an edit'
);

select tests.as_user('10000000-0000-0000-0000-000000000012', false);
select is((select count(*) from trips), 0::bigint, 'an outsider cannot read another trip');
select throws_ok(
  $$select add_placeholder_participant('00000000-0000-0000-0000-000000000000', 'No access')$$,
  '.*not an active member.*',
  'an outsider cannot mutate another trip'
);

select tests.as_user('10000000-0000-0000-0000-000000000011', false);
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trip_activity_log'
      and (cmd = 'UPDATE' or cmd = 'DELETE' or cmd = 'ALL')
  ),
  'activity log has no client update or delete policy'
);
set local role postgres;
select throws_ok(
  $$update trip_activity_log set description = 'tampered'$$,
  '.*immutable.*',
  'activity log trigger rejects updates that bypass RLS'
);
select throws_ok(
  $$delete from trip_activity_log$$,
  '.*immutable.*',
  'activity log trigger rejects deletes that bypass RLS'
);
select is(
  (select count(*) from participants where linked_user_id = '10000000-0000-0000-0000-000000000011'),
  1::bigint,
  'trip creator gets a registered participant identity'
);
select ok(
  exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'processed_requests'),
  'processed request visibility is protected by RLS'
);

select * from finish();
rollback;
