begin;
select plan(9);

select tests.create_user('10000000-0000-0000-0000-000000000001', 'split-owner@example.test');
select tests.as_user('10000000-0000-0000-0000-000000000001', false);

insert into trips (id, name, currency, created_by)
values ('20000000-0000-0000-0000-000000000001', 'Split math', 'INR', '10000000-0000-0000-0000-000000000001');
-- trip_active_participant_weights only counts a registered participant when their
-- linked_user_id has an *active* trip_members row (0003_rls_and_rpcs.sql) -- true for
-- every real trip, since create_trip/join_trip_via_code always insert both rows
-- together, but this fixture bypassed both RPCs and inserted straight into
-- trips/participants without ever adding one here. That silently dropped the owner from
-- every equal-split weight below, so a 3-way equal split came out as a 2-way 50/50 split
-- instead -- confirmed by actually running this file, not by reading it.
insert into trip_members (trip_id, user_id, status)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'active');
insert into participants (id, trip_id, type, linked_user_id, display_name, created_by)
values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'registered', '10000000-0000-0000-0000-000000000001', 'Owner', '10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'placeholder', null, 'Guest 1', '10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'placeholder', null, 'Guest 2', '10000000-0000-0000-0000-000000000001');

insert into expenses (id, trip_id, description, amount, currency, paid_by, split_type, split_config, created_by)
values ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Equal', 100, 'INR', '30000000-0000-0000-0000-000000000001', 'equal', '{}', '10000000-0000-0000-0000-000000000001');
select compute_expense_splits('40000000-0000-0000-0000-000000000001');
select is((select count(*) from expense_splits where expense_id = '40000000-0000-0000-0000-000000000001'), 3::bigint, 'equal split has one share per participant');
select is((select sum(share_amount) from expense_splits where expense_id = '40000000-0000-0000-0000-000000000001'), 100::numeric, 'equal split totals the expense');
select is((select max(share_amount) from expense_splits where expense_id = '40000000-0000-0000-0000-000000000001'), 33.34::numeric, 'equal split assigns one deterministic remainder unit');

insert into expenses (id, trip_id, description, amount, currency, paid_by, split_type, split_config, created_by)
values ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Exact', 100, 'INR', '30000000-0000-0000-0000-000000000001', 'exact', '{"shares":{"30000000-0000-0000-0000-000000000001":"20.00","30000000-0000-0000-0000-000000000002":"30.00","30000000-0000-0000-0000-000000000003":"50.00"}}', '10000000-0000-0000-0000-000000000001');
select compute_expense_splits('40000000-0000-0000-0000-000000000002');
select is((select sum(share_amount) from expense_splits where expense_id = '40000000-0000-0000-0000-000000000002'), 100::numeric, 'exact split totals the expense');
select is((select share_amount from expense_splits where expense_id = '40000000-0000-0000-0000-000000000002' and participant_id = '30000000-0000-0000-0000-000000000002'), 30::numeric, 'exact split preserves decimal currency amounts');

insert into expenses (id, trip_id, description, amount, currency, paid_by, split_type, split_config, created_by)
values ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'Itemized exact', 100, 'INR', '30000000-0000-0000-0000-000000000001', 'itemized', '{"items":[{"label":"shared","amount":"100.00","amounts":{"30000000-0000-0000-0000-000000000001":"40.00","30000000-0000-0000-0000-000000000002":"60.00"}}]}', '10000000-0000-0000-0000-000000000001');
select compute_expense_splits('40000000-0000-0000-0000-000000000003');
select is((select sum(share_amount) from expense_splits where expense_id = '40000000-0000-0000-0000-000000000003'), 100::numeric, 'itemized exact amounts total the expense');
select is((select share_amount from expense_splits where expense_id = '40000000-0000-0000-0000-000000000003' and participant_id = '30000000-0000-0000-0000-000000000002'), 60::numeric, 'itemized exact amount is preserved');

select lives_ok(
  $$select compute_expense_splits('40000000-0000-0000-0000-000000000002')$$,
  'recomputing a valid split remains callable'
);
insert into expenses (id, trip_id, description, amount, currency, paid_by, split_type, split_config, created_by)
values ('40000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', 'Bad exact', 100, 'INR', '30000000-0000-0000-0000-000000000001', 'exact', '{"shares":{"30000000-0000-0000-0000-000000000001":"20.00"}}', '10000000-0000-0000-0000-000000000001');
-- This pgTAP install's throws_ok compares the message argument with exact string
-- equality (SQLERRM = errmsg), not a regex -- '.*' as a literal pattern can never equal
-- the real message, so this assertion could never pass as written. NULL/NULL means "any
-- exception, don't check code or message," which is what "invalid config is rejected"
-- actually needs. Found by actually running this suite, not by reading it -- same root
-- cause behind every other throws_ok fix in this pass (see 0003_rpc_permissions.sql).
select throws_ok(
  $$select compute_expense_splits('40000000-0000-0000-0000-000000000004')$$,
  NULL, NULL,
  'invalid exact configuration is rejected by split computation'
);

select * from finish();
rollback;
