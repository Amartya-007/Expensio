begin;
select plan(13);

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'trips', 'trips table exists');
select has_table('public', 'participants', 'participants table exists');
select has_table('public', 'expenses', 'expenses table exists');
select has_table('public', 'expense_splits', 'expense_splits table exists');
select has_table('public', 'ledger_entries', 'ledger_entries table exists');
select has_table('public', 'trip_activity_log', 'activity log table exists');
select has_function('public', 'compute_expense_splits', array['uuid'], 'split function exists');
select has_trigger(
  'public', 'trip_activity_log', 'no_update_activity_log',
  'activity log update guard exists'
);
select has_trigger(
  'public', 'trip_activity_log', 'no_delete_activity_log',
  'activity log delete guard exists'
);
select ok(
  exists (
    select 1
    from pg_publication p
    join pg_publication_rel pr on pr.prpubid = p.oid
    join pg_class c on c.oid = pr.prrelid
    where p.pubname = 'powersync' and c.relname = 'expenses'
  ),
  'expenses is in the powersync publication'
);
select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'participants'
      and indexdef like '%(trip_id, phone)%'
  ),
  'placeholder phone uniqueness index exists'
);
select ok(
  exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'handle_new_user'
  ),
  'auth user profile trigger function exists'
);

select * from finish();
rollback;
