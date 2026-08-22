begin;
select plan(7);

select has_table('public', 'notification_events', 'notification queue exists');
select has_column('public', 'profiles', 'notification_preferences', 'profile notification preferences exist');
select has_function('public', 'enqueue_notification_event', array['text', 'text', 'uuid', 'uuid', 'uuid', 'uuid', 'jsonb'], 'queue function exists');
select has_function('public', 'update_notification_preferences', array['jsonb'], 'preference RPC exists');
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'notification_events'
      and indexname = 'notification_events_pending_idx'
  ),
  'notification queue has a pending-work index'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'ledger_notification_event'
  ),
  'ledger inserts enqueue notification work'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'comment_notification_event'
  ),
  'user comments enqueue notification work'
);

select * from finish();
rollback;
