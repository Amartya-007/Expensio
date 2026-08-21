alter table profiles
  add column if not exists notification_preferences jsonb not null
    default '{"push": true, "email": true, "digest": false}'::jsonb;

create table notification_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  trip_id uuid not null references trips(id) on delete cascade,
  actor_id uuid references profiles(id),
  expense_id uuid references expenses(id) on delete set null,
  subject_participant_id uuid references participants(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index notification_events_pending_idx
  on notification_events (next_attempt_at, created_at)
  where status in ('pending', 'processing');
create index notification_events_trip_idx
  on notification_events (trip_id, created_at);

alter table notification_events enable row level security;

create function enqueue_notification_event(
  p_event_key text,
  p_event_type text,
  p_trip_id uuid,
  p_actor_id uuid default null,
  p_expense_id uuid default null,
  p_subject_participant_id uuid default null,
  p_payload jsonb default '{}'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into notification_events (
    event_key, event_type, trip_id, actor_id, expense_id,
    subject_participant_id, payload
  ) values (
    p_event_key, p_event_type, p_trip_id, p_actor_id, p_expense_id,
    p_subject_participant_id, p_payload
  )
  on conflict (event_key) do update
    set payload = notification_events.payload || excluded.payload
  returning id into v_id;

  return v_id;
end; $$;

create function enqueue_ledger_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_event_type text;
  v_event_key text;
begin
  if new.metadata ->> 'role' = 'migration_backfill' then
    return new;
  end if;

  v_event_type := case new.entry_type
    when 'expense_added' then 'expense_added'
    when 'expense_edited' then 'expense_edited'
    when 'expense_deleted' then 'expense_deleted'
    when 'payment_recorded' then 'payment_recorded'
    when 'payment_confirmed' then 'payment_confirmed'
    when 'payment_disputed' then 'payment_disputed'
    else null
  end;

  if v_event_type is null then
    return new;
  end if;

  v_event_key := case
    when new.expense_id is not null then 'expense:' || new.expense_id::text || ':' || v_event_type
    else 'ledger:' || new.id::text || ':' || v_event_type
  end;

  perform enqueue_notification_event(
    v_event_key,
    v_event_type,
    new.trip_id,
    new.created_by,
    new.expense_id,
    new.to_participant,
    jsonb_build_object(
      'ledger_entry_id', new.id,
      'amount', new.amount,
      'currency', new.currency,
      'from_participant', new.from_participant,
      'to_participant', new.to_participant,
      'metadata', new.metadata
    )
  );

  return new;
end; $$;

create trigger ledger_notification_event
  after insert on ledger_entries
  for each row execute function enqueue_ledger_notification();

create function enqueue_comment_notification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.comment_type = 'user' then
    perform enqueue_notification_event(
      'comment:' || new.id::text,
      'comment_added',
      (select trip_id from expenses where id = new.expense_id),
      new.user_id,
      new.expense_id,
      null,
      jsonb_build_object('comment_id', new.id)
    );
  end if;
  return new;
end; $$;

create trigger comment_notification_event
  after insert on expense_comments
  for each row execute function enqueue_comment_notification();

create function enqueue_activity_notification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.event_type in (
    'member_joined', 'member_rejoined', 'member_left',
    'invite_generated', 'invite_revoked', 'invite_join_undone', 'category_added'
  ) then
    perform enqueue_notification_event(
      'activity:' || new.id::text,
      new.event_type,
      new.trip_id,
      new.actor_id,
      null,
      new.subject_participant_id,
      jsonb_build_object('activity_id', new.id, 'description', new.description, 'metadata', new.metadata)
    );
  end if;
  return new;
end; $$;

create trigger activity_notification_event
  after insert on trip_activity_log
  for each row execute function enqueue_activity_notification();

create function update_notification_preferences(p_preferences jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if jsonb_typeof(p_preferences) <> 'object'
     or exists (
       select 1
       from jsonb_each(p_preferences) as setting(key, value)
       where setting.key not in ('push', 'email', 'digest')
          or jsonb_typeof(setting.value) <> 'boolean'
     ) then
    raise exception 'notification preferences must be an object with boolean push, email, and digest keys';
  end if;

  update profiles
  set notification_preferences = jsonb_build_object(
    'push', coalesce((p_preferences ->> 'push')::boolean, true),
    'email', coalesce((p_preferences ->> 'email')::boolean, true),
    'digest', coalesce((p_preferences ->> 'digest')::boolean, false)
  )
  where id = auth.uid();
end; $$;

revoke execute on function enqueue_notification_event(text, text, uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function enqueue_ledger_notification() from public, anon, authenticated;
revoke execute on function enqueue_comment_notification() from public, anon, authenticated;
revoke execute on function enqueue_activity_notification() from public, anon, authenticated;
