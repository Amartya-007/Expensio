-- ============================================================================
-- Expensio — core schema
--
-- Transcribed from docs/architecture/expensio-data-model.md. One fix applied
-- during transcription: the doc defines trip_members (which references
-- trip_invites.id via joined_via_invite_id) BEFORE trip_invites itself — a
-- forward reference that fails on a fresh apply. Reordered here: trip_invites
-- now comes before trip_members. No other change from the doc's DDL.
-- ============================================================================

-- Extends auth.users with app-facing profile data.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  deleted_at timestamptz,              -- set by delete_account(); id and history are kept
  created_at timestamptz not null default now()
);

create table trips (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'INR',
  created_by uuid not null references profiles(id),
  settings jsonb not null default '{}'::jsonb,  -- includes budget_per_person
  start_date date,                    -- both null = "no fixed timeframe" (flow doc §2, step 4)
  end_date date,                      -- a trip can have dates added/changed/cleared later
  is_archived boolean not null default false,
  deleted_at timestamptz,             -- soft-hide, not a real DELETE — see delete_trip below
                                       -- for why a true hard delete would have destroyed the
                                       -- immutable trip_activity_log along with it
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_date_range check (end_date is null or start_date is null or end_date >= start_date)
);

-- Codes are NOT declared unique at the DB level — see generate_invite in
-- 0003_rpcs.sql for why a hard UNIQUE(code) doesn't hold up at 6 digits, and
-- how uniqueness among currently-valid codes is enforced instead.
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

-- ACCESS ONLY. Answers "can this auth.uid() read/write this trip" — nothing else. No role
-- column: every active member has identical permissions (see permissions doc, "almost
-- nobody has destructive power over other people"). The only ways a row here changes after
-- creation are join_trip_via_code and leave_trip — never a forced removal.
-- joined_via_invite_id enables one narrow exception: an inviter undoing their own recent
-- mistake — see revoke_recent_join in 0003_rpcs.sql.
create table trip_members (
  trip_id uuid not null references trips(id) on delete cascade,
  user_id uuid not null references profiles(id),
  status text not null default 'active' check (status in ('active', 'left')),
  joined_at timestamptz not null default now(),
  joined_via_invite_id uuid references trip_invites(id),
  left_at timestamptz,
  primary key (trip_id, user_id)
);

-- FINANCIAL IDENTITY ONLY. Answers "who can be paid_by / owe a split / appear in the
-- ledger" for this specific trip. A 'registered' row always has a matching trip_members row
-- for the same (trip_id, linked_user_id) — created alongside it in create_trip and
-- join_trip_via_code. A 'placeholder' row never does, and never needs to: they have no
-- auth.uid(), so any active trip member manages their expenses on their behalf (permissions
-- doc §2 pattern — "any active member", not a new tier).
create table participants (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  type text not null check (type in ('registered', 'placeholder')),
  linked_user_id uuid references profiles(id),
  display_name text not null,
  phone text,                          -- required to add a placeholder invite target; optional otherwise
  created_by uuid not null references profiles(id),
  invite_sent_at timestamptz,          -- null until an SMS/email invite actually goes out
  created_at timestamptz not null default now(),
  constraint registered_needs_user check (type = 'placeholder' or linked_user_id is not null)
);
-- One participant row per real person per trip — prevents a registered member somehow
-- getting two ledger identities in the same trip.
create unique index on participants(trip_id, linked_user_id) where linked_user_id is not null;

-- Prevents a real bug found while testing join_trip_via_code's claim-by-phone logic: if two
-- placeholders in the same trip ever shared a phone number (e.g. added twice by mistake),
-- the claim UPDATE there matches BOTH rows — Postgres's `UPDATE ... RETURNING id INTO
-- v_claimed_id` doesn't error on a multi-row match, it silently takes one value while both
-- rows still get updated — so both placeholders end up claimed by the same joining user,
-- which then violates the unique index above with a confusing error instead of a clear one.
-- This index stops the duplicate-phone state from ever existing in the first place.
create unique index on participants(trip_id, phone) where type = 'placeholder' and phone is not null;

-- Recurring-expense definitions. A scheduled job turns due templates into real
-- expenses via the same add_expense RPC everything else uses — no separate write path.
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
  currency text not null,             -- per-expense, not inherited — a trip can mix currencies
  exchange_rate_override numeric(14,6),  -- null = use a live-fetched rate for display conversion;
                                          -- set = trust this instead (architecture doc §7)
  paid_by uuid not null references participants(id),
  category text,
  expense_date date not null default current_date,
  split_type text not null default 'equal'
    check (split_type in ('equal', 'exact', 'percentage', 'shares', 'adjustment', 'itemized', 'reimbursement')),
  split_config jsonb not null default '{}'::jsonb,
  source_template_id uuid references expense_templates(id),
  created_by uuid not null references profiles(id),   -- always a real user — someone had to tap the button
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Multiple photos per expense — receipts AND general "photo memories," not just one
-- receipt_path. A trip's shared photo feed is just a query across this table by trip_id.
create table expense_attachments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expenses(id) on delete cascade,
  storage_path text not null,          -- Supabase Storage path
  uploaded_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

-- Trip-scoped, shared with all members — a custom category one person creates is visible
-- and reusable by everyone in the trip, not private to them. Default categories (name +
-- icon) are static app-bundled data, not rows here — this table exists only for the
-- custom ones, which is also why it doesn't need to be big or heavily indexed.
create table custom_categories (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  name text not null,
  icon text not null,                  -- key into the app's bundled icon set
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

-- Server-computed, one row per participant's share of an expense.
create table expense_splits (
  expense_id uuid not null references expenses(id) on delete cascade,
  participant_id uuid not null references participants(id),
  share_amount numeric(12,2) not null,
  primary key (expense_id, participant_id)
);

-- User discussion AND the system-generated edit trail, in one feed. user_id stays on
-- profiles, not participants — only a real logged-in person can write a comment; a
-- placeholder has nothing to type with.
create table expense_comments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expenses(id) on delete cascade,
  user_id uuid not null references profiles(id),
  comment_type text not null default 'user' check (comment_type in ('user', 'system')),
  body text not null,
  created_at timestamptz not null default now()
);

-- Append-only. Nothing in this table is ever UPDATEd.
create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  entry_type text not null check (entry_type in (
    'expense_added', 'expense_edited', 'expense_deleted',
    'payment_recorded', 'payment_confirmed', 'payment_disputed'
  )),
  expense_id uuid references expenses(id),
  from_participant uuid references participants(id),   -- who owes / who paid
  to_participant uuid references participants(id),     -- who is owed / who received
  amount numeric(12,2) not null,
  currency text not null,
  created_by uuid not null references profiles(id),    -- always a real user
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Derived, never written to directly. One row per (trip, participant, currency).
create view trip_balances as
select trip_id, from_participant as participant_id, currency, -sum(amount) as balance_delta
from ledger_entries where from_participant is not null
group by trip_id, from_participant, currency
union all
select trip_id, to_participant as participant_id, currency, sum(amount) as balance_delta
from ledger_entries where to_participant is not null
group by trip_id, to_participant, currency;

-- Idempotency for offline-queued RPCs (architecture doc §5). A client generates one UUID
-- per user action and passes it as p_client_request_id; a retried call after a flaky
-- offline reconnect checks this table first and no-ops if already applied, instead of
-- creating a duplicate expense/payment/join. One dedup table shared by every RPC, not one
-- idempotency column bolted onto each individual table.
--
-- `result` extends the design in the doc: every RPC that returns an id/code now stores its
-- result here on first success, and returns the STORED result on replay instead of null —
-- see claim_idempotency_key / the "returns null on replay" fix in 0003_rpcs.sql for why.
create table processed_requests (
  client_request_id uuid primary key,
  result jsonb,
  created_at timestamptz not null default now()
);

-- The trip-wide immutable activity log — separate from ledger_entries (which is
-- specifically the financial ledger trip_balances sums) and separate from
-- expense_comments (which is a per-expense discussion thread). This is the comprehensive,
-- chronological "what happened in this trip" feed: every expense/payment/membership/
-- category/name-change event, in one place, per trip.
--
-- description is a snapshot, generated and frozen at insert time (via the log_activity
-- helper in 0003_rpcs.sql) — NOT a live join through profiles. If someone renames
-- themselves later, old entries still read with the name that was true when the event
-- happened. This is deliberately different from how participants.display_name resolves —
-- that's for "who is this, right now"; this is a historical record.
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
  actor_id uuid references profiles(id),               -- who performed the action
  subject_participant_id uuid references participants(id),  -- who/what it's about, if applicable
  description text not null,           -- human-readable, frozen at write time
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Immutable means immutable, enforced by Postgres itself, not just "we don't write RPCs
-- that touch it." Even a SECURITY DEFINER function bypasses RLS but NOT a trigger — this
-- fires no matter how the row is approached, which is the actual guarantee that was asked for.
create function prevent_activity_log_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'trip_activity_log is immutable — % is not permitted', TG_OP;
end; $$;

create trigger no_update_activity_log before update on trip_activity_log
  for each row execute function prevent_activity_log_mutation();
create trigger no_delete_activity_log before delete on trip_activity_log
  for each row execute function prevent_activity_log_mutation();

-- Indexes
create index on trip_members(user_id);
create index on participants(trip_id);
create index on expenses(trip_id);
create index on expense_attachments(expense_id);
create index on custom_categories(trip_id);
create index on expense_comments(expense_id);
create index on ledger_entries(trip_id, created_at);
create index on expense_templates(next_run_date) where is_active;
-- Backs generate_due_recurring_expenses's idempotency claim — a template can produce at
-- most one expense per calendar date, so even a genuine double-run of the scheduled job
-- can't duplicate a recurring charge.
create unique index on expenses(source_template_id, expense_date) where source_template_id is not null;
create index on trip_activity_log(trip_id, created_at);
create index on processed_requests(created_at);
