create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name) values (new.id, null);
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

create table trips (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'INR',
  created_by uuid not null references profiles(id),
  settings jsonb not null default '{}'::jsonb,
  start_date date,
  end_date date,
  is_archived boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_date_range check (end_date is null or start_date is null or end_date >= start_date)
);

create table trip_invites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  code text not null,
  created_by uuid not null references profiles(id),
  max_uses int,
  use_count int not null default 0,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table trip_members (
  trip_id uuid not null references trips(id) on delete cascade,
  user_id uuid not null references profiles(id),
  status text not null default 'active' check (status in ('active', 'left')),
  joined_at timestamptz not null default now(),
  joined_via_invite_id uuid references trip_invites(id),
  left_at timestamptz,
  primary key (trip_id, user_id)
);

create table participants (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  type text not null check (type in ('registered', 'placeholder')),
  linked_user_id uuid references profiles(id),
  display_name text not null,
  phone text,
  created_by uuid not null references profiles(id),
  invite_sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint registered_needs_user check (type = 'placeholder' or linked_user_id is not null)
);
create unique index on participants(trip_id, linked_user_id) where linked_user_id is not null;

create unique index on participants(trip_id, phone) where type = 'placeholder' and phone is not null;

create table expense_templates (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null,
  paid_by uuid not null references participants(id),
  category text,
  split_type text not null default 'equal',
  split_config jsonb not null default '{}'::jsonb,
  recurrence_rule text not null check (recurrence_rule in ('weekly', 'monthly', 'yearly')),
  next_run_date date not null,
  is_active boolean not null default true,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null,
  exchange_rate_override numeric(14,6),
  paid_by uuid not null references participants(id),
  category text,
  expense_date date not null default current_date,
  split_type text not null default 'equal'
    check (split_type in ('equal', 'exact', 'percentage', 'shares', 'adjustment', 'itemized', 'reimbursement')),
  split_config jsonb not null default '{}'::jsonb,
  source_template_id uuid references expense_templates(id),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table expense_attachments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expenses(id) on delete cascade,
  storage_path text not null,
  uploaded_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create table custom_categories (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  name text not null,
  icon text not null,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create table expense_splits (
  expense_id uuid not null references expenses(id) on delete cascade,
  participant_id uuid not null references participants(id),
  share_amount numeric(12,2) not null,
  primary key (expense_id, participant_id)
);

create table expense_comments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expenses(id) on delete cascade,
  user_id uuid not null references profiles(id),
  comment_type text not null default 'user' check (comment_type in ('user', 'system')),
  body text not null,
  created_at timestamptz not null default now()
);

create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  entry_type text not null check (entry_type in (
    'expense_added', 'expense_edited', 'expense_deleted',
    'payment_recorded', 'payment_confirmed', 'payment_disputed'
  )),
  expense_id uuid references expenses(id),
  from_participant uuid references participants(id),
  to_participant uuid references participants(id),
  amount numeric(12,2) not null,
  currency text not null,
  created_by uuid not null references profiles(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create view trip_balances as
select trip_id, from_participant as participant_id, currency, -sum(amount) as balance_delta
from ledger_entries where from_participant is not null
group by trip_id, from_participant, currency
union all
select trip_id, to_participant as participant_id, currency, sum(amount) as balance_delta
from ledger_entries where to_participant is not null
group by trip_id, to_participant, currency;

create table processed_requests (
  client_request_id uuid primary key,
  result jsonb,
  created_at timestamptz not null default now()
);

create table trip_activity_log (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  event_type text not null check (event_type in (
    'trip_created', 'trip_archived', 'trip_unarchived',
    'expense_added', 'expense_edited', 'expense_deleted',
    'payment_recorded', 'payment_confirmed',
    'member_joined', 'member_rejoined', 'member_left',
    'placeholder_added', 'placeholder_claimed',
    'invite_generated', 'invite_revoked', 'invite_join_undone',
    'display_name_changed', 'category_added'
  )),
  actor_id uuid references profiles(id),
  subject_participant_id uuid references participants(id),
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create function prevent_activity_log_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'trip_activity_log is immutable — % is not permitted', TG_OP;
end; $$;

create trigger no_update_activity_log before update on trip_activity_log
  for each row execute function prevent_activity_log_mutation();
create trigger no_delete_activity_log before delete on trip_activity_log
  for each row execute function prevent_activity_log_mutation();

create index on trip_members(user_id);
create index on participants(trip_id);
create index on expenses(trip_id);
create index on expense_attachments(expense_id);
create index on custom_categories(trip_id);
create index on expense_comments(expense_id);
create index on ledger_entries(trip_id, created_at);
create index on expense_templates(next_run_date) where is_active;
create unique index on expenses(source_template_id, expense_date) where source_template_id is not null;
create index on trip_activity_log(trip_id, created_at);
create index on processed_requests(created_at);

alter table trips replica identity full;
alter table trip_invites replica identity full;
alter table trip_members replica identity full;
alter table participants replica identity full;
alter table expense_templates replica identity full;
alter table expenses replica identity full;
alter table expense_attachments replica identity full;
alter table custom_categories replica identity full;
alter table expense_splits replica identity full;
alter table expense_comments replica identity full;
alter table ledger_entries replica identity full;
alter table trip_activity_log replica identity full;

alter publication powersync add table
  trips, trip_invites, trip_members, participants, expense_templates, expenses,
  expense_attachments, custom_categories, expense_splits, expense_comments,
  ledger_entries, trip_activity_log;
