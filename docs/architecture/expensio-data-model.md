# Expensio — Data Model

Companion to `expensio-architecture.md`. One schema for both solo and collaborative trips —
see architecture doc §3 for why there's no separate "local" shape.

**One structural decision worth stating up front, since it's the key correction to the
manual-participant design:** `trip_members` and `participants` are two different things,
not one renamed table. `trip_members` answers "who has *access* to this trip" — it only
ever exists for people with a real, phone-verified `auth.uid()`, because that's what RLS
checks against. `participants` answers "who appears in the *financial ledger*" — every
active member has a matching participant row, but a participant doesn't need a matching
member row, because a manually-added placeholder has no account and nothing to authenticate.
Conflating the two would mean either giving placeholders fake access rows they can never use,
or teaching every RLS policy to understand "invited but not real yet" — both worse than
keeping the two concerns separate.

## Entity relationship diagram

```mermaid
erDiagram
    PROFILES ||--o{ TRIP_MEMBERS : "is"
    PROFILES ||--o{ PARTICIPANTS : "may be linked to"
    TRIPS ||--o{ TRIP_MEMBERS : "has"
    TRIPS ||--o{ PARTICIPANTS : "has"
    TRIPS ||--o{ EXPENSES : "has"
    TRIPS ||--o{ TRIP_INVITES : "has"
    TRIPS ||--o{ LEDGER_ENTRIES : "has"
    TRIPS ||--o{ EXPENSE_TEMPLATES : "has"
    TRIPS ||--o{ CUSTOM_CATEGORIES : "has"
    TRIPS ||--o{ TRIP_ACTIVITY_LOG : "has"
    PARTICIPANTS ||--o{ TRIP_ACTIVITY_LOG : "is subject of"
    PROFILES ||--o{ TRIP_ACTIVITY_LOG : "acts in"
    EXPENSE_TEMPLATES ||--o{ EXPENSES : "generates"
    EXPENSES ||--o{ EXPENSE_SPLITS : "splits into"
    EXPENSES ||--o{ LEDGER_ENTRIES : "generates"
    EXPENSES ||--o{ EXPENSE_COMMENTS : "has"
    EXPENSES ||--o{ EXPENSE_ATTACHMENTS : "has"
    PARTICIPANTS ||--o{ EXPENSES : "paid_by"
    PARTICIPANTS ||--o{ EXPENSE_SPLITS : "owes"
    PARTICIPANTS ||--o{ LEDGER_ENTRIES : "from_participant / to_participant"
    PROFILES ||--o{ EXPENSE_COMMENTS : "writes"
    PROFILES ||--o{ EXPENSE_ATTACHMENTS : "uploads"

    PROFILES {
        uuid id PK
        text display_name
        text avatar_url
        timestamptz deleted_at
        timestamptz created_at
    }
    TRIPS {
        uuid id PK
        text name
        text currency
        uuid created_by FK
        jsonb settings
        date start_date
        date end_date
        boolean is_archived
        timestamptz created_at
    }
    TRIP_MEMBERS {
        uuid trip_id FK
        uuid user_id FK
        text status
        timestamptz joined_at
        uuid joined_via_invite_id FK
        timestamptz left_at
    }
    PARTICIPANTS {
        uuid id PK
        uuid trip_id FK
        text type
        uuid linked_user_id FK
        text display_name
        text phone
        uuid created_by FK
        timestamptz invite_sent_at
    }
    TRIP_INVITES {
        uuid id PK
        uuid trip_id FK
        text code
        int max_uses
        int use_count
        timestamptz expires_at
        timestamptz revoked_at
    }
    CUSTOM_CATEGORIES {
        uuid id PK
        uuid trip_id FK
        text name
        text icon
        uuid created_by FK
    }
    TRIP_ACTIVITY_LOG {
        uuid id PK
        uuid trip_id FK
        text event_type
        uuid actor_id FK
        uuid subject_participant_id FK
        text description
        jsonb metadata
        timestamptz created_at
    }
    EXPENSES {
        uuid id PK
        uuid trip_id FK
        text description
        numeric amount
        text currency
        numeric exchange_rate_override
        uuid paid_by FK
        text split_type
        jsonb split_config
        uuid source_template_id FK
        timestamptz deleted_at
    }
    EXPENSE_ATTACHMENTS {
        uuid id PK
        uuid expense_id FK
        text storage_path
        uuid uploaded_by FK
    }
    EXPENSE_SPLITS {
        uuid expense_id FK
        uuid participant_id FK
        numeric share_amount
    }
    EXPENSE_TEMPLATES {
        uuid id PK
        uuid trip_id FK
        text description
        numeric amount
        text split_type
        jsonb split_config
        text recurrence_rule
        date next_run_date
        boolean is_active
    }
    EXPENSE_COMMENTS {
        uuid id PK
        uuid expense_id FK
        uuid user_id FK
        text comment_type
        text body
        timestamptz created_at
    }
    LEDGER_ENTRIES {
        uuid id PK
        uuid trip_id FK
        text entry_type
        uuid expense_id FK
        uuid from_participant FK
        uuid to_participant FK
        numeric amount
        jsonb metadata
        timestamptz created_at
    }
```

## Design principles behind this schema

1. **No denormalized member arrays.** `trip_members` is the one place *access* lives.
   Nothing else caches a list of who's in a trip.
2. **Access and financial identity are separate tables, on purpose.** See the note at the
   top of this doc — `trip_members` (access) vs `participants` (ledger attribution).
3. **Nothing about money is ever `UPDATE`d.** `ledger_entries` is insert-only. `expenses`
   can be edited (it's a record of "what is this expense currently"), but every edit also
   writes a `ledger_entries` row, so the history of what changed is never lost even though
   the current-state row is mutable.
4. **`jsonb` is used deliberately, not everywhere.** `trips.settings` and
   `expenses.split_config` are the two places the schema needs to flex without a migration.
   Everything load-bearing for permissions or money (`status`, `type`, `amount`, foreign
   keys) is a real typed column.
5. **The client never computes its own splits.** `expense_splits` rows are generated
   server-side, inside the `add_expense`/`edit_expense` RPCs, from `split_type` +
   `split_config` — never as a client-supplied array. The client sends intent; Postgres is
   the only thing that turns that into per-person numbers.
6. **A placeholder's display name is theirs; a registered member's isn't, really.**
   `participants.display_name` is authoritative for `type = 'placeholder'` (there's no
   profile to draw from). For `type = 'registered'`, treat `profiles.display_name` (via
   `linked_user_id`) as the source of truth — `participants.display_name` is just a
   creation-time snapshot. This is also why account deletion (further down) needs no special
   handling for participants: once a profile is pseudonymized, every registered participant
   row reflects that automatically through the join.

7. **The activity log commits atomically with the change it describes, by construction.**
   Every RPC that writes a domain change also writes its `trip_activity_log` row inside the
   same function body — a single Postgres function call is one transaction, so if anything
   after the log insert fails, the whole thing rolls back together. There's no separate
   "log the event" step that could succeed while the actual mutation fails, or vice versa.
8. **Offline-replayed writes are idempotent, not just retried.** Every state-changing RPC
   takes an optional `p_client_request_id` — a UUID the client generates once per action and
   reuses if a call has to be retried after a flaky offline reconnect. `processed_requests`
   is the shared dedup table; a second call with the same key is a no-op, not a duplicate
   expense or a double join.

```sql
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
  deleted_at timestamptz,             -- soft-hide, not a real DELETE — see delete_trip in the
                                       -- permissions doc for why a true hard delete would have
                                       -- destroyed the immutable trip_activity_log along with it
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_date_range check (end_date is null or start_date is null or end_date >= start_date)
);

-- ACCESS ONLY. Answers "can this auth.uid() read/write this trip" — nothing else. No role
-- column: every active member has identical permissions (see permissions doc, "almost
-- nobody has destructive power over other people"). The only ways a row here changes after
-- creation are join_trip_via_code and leave_trip — never a forced removal.
-- joined_via_invite_id enables one narrow exception: an inviter undoing their own recent
-- mistake — see revoke_recent_join in the permissions doc.
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

-- Codes are NOT declared unique at the DB level — see generate_invite in the permissions
-- doc for why a hard UNIQUE(code) doesn't hold up at 6 digits, and how uniqueness among
-- currently-valid codes is enforced instead.
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
create table processed_requests (
  client_request_id uuid primary key,
  created_at timestamptz not null default now()
);

-- The trip-wide immutable activity log — separate from ledger_entries (which is
-- specifically the financial ledger trip_balances sums) and separate from
-- expense_comments (which is a per-expense discussion thread). This is the comprehensive,
-- chronological "what happened in this trip" feed: every expense/payment/membership/
-- category/name-change event, in one place, per trip.
--
-- description is a snapshot, generated and frozen at insert time (via the log_activity
-- helper in the permissions doc) — NOT a live join through profiles. If someone renames
-- themselves later, old entries still read with the name that was true when the event
-- happened. This is deliberately different from how participants.display_name resolves
-- (Design Principle 6) — that's for "who is this, right now"; this is a historical record.
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
-- fires no matter how the row is approached, which is the actual guarantee you asked for.
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
-- Backs generate_due_recurring_expenses's idempotency claim (permissions doc §5) — a
-- template can produce at most one expense per calendar date, so even a genuine double-run
-- of the scheduled job can't duplicate a recurring charge.
create unique index on expenses(source_template_id, expense_date) where source_template_id is not null;
create index on trip_activity_log(trip_id, created_at);
create index on processed_requests(created_at);
```

## `split_config` shapes, one per `split_type`

Unchanged in shape from before — the values inside are now **`participant_id`s**, not
`user_id`s, since `expense_splits`/`ledger_entries` point at `participants` now.

| `split_type` | `split_config` shape | Who it's for |
|---|---|---|
| `equal` | `{}` (all active participants, equal shares) | default |
| `exact` | `{"shares": {"pid1": 500, "pid2": 300}}` | "I know exactly what each person owes" |
| `percentage` | `{"shares": {"pid1": 60, "pid2": 40}}` | must sum to 100, validated in the RPC |
| `shares` | `{"units": {"pid1": 2, "pid2": 1}}` | proportional, e.g. couple = 2 units, solo = 1 |
| `adjustment` | `{"adjustments": {"pid1": 200}, "remainder": "equal"}` | one person gets a fixed extra/less, rest splits the remainder equally |
| `itemized` | `{"items": [{"label": "Pizza", "amount": 450, "shared_by": ["pid1","pid2"]}], "tax": 40, "tip": 60, "tax_tip_split": "proportional"}` | line-item receipt splitting |
| `reimbursement` | `{"reimburse_to": "pid1", "shares": {"pid2": 500, "pid3": 500}}` | inverse of a normal expense |

## `compute_expense_splits` — the rounding rule that was never actually specified

Referenced by name in `add_expense`/`edit_expense` throughout the permissions doc; this is
what it actually does. The one rule that matters most: **compute in the smallest currency
unit (integer paise/cents), never floating point** — dividing ₹100 three ways as floats
gives 33.333... repeating, and floating-point drift on money is exactly the kind of bug that
looks fine in testing and then someone's balance is off by a paisa in production.

For every `split_type`, the shares must sum to *exactly* the expense total — not
"approximately," not "off by a rounding unit." The pattern is the same across all seven:
compute each share proportionally in integer minor units, then any leftover minor units
(from the proportional division not dividing evenly) go to participants **in a fixed,
deterministic order — sorted by `participant_id`** — one extra minor unit each until the
leftover is exhausted.

- **`equal`**: `total_minor_units / N` per participant, integer division; remainder
  distributed as above. (₹100 ÷ 3 → ₹33.33 / ₹33.33 / ₹33.34, and *which* participant gets
  the ₹33.34 is always the same for the same input — deterministic, not arbitrary-feeling.)
- **`exact`**: use the provided shares directly, but **validate they sum to the total in
  minor units** before accepting — reject with a clear error rather than silently rescaling
  if they don't match. Never trust the client's arithmetic, same principle as everywhere
  else in this design.
- **`percentage`**: each share = `total_minor_units * pct / 100`, rounded down; remainder
  distributed by the same deterministic rule. Reject if percentages don't sum to 100 before
  doing any math.
- **`shares`**: proportional by unit count (`total_minor_units * participant_units /
  total_units`), same rounding-remainder handling.
- **`adjustment`**: fixed adjustments applied first, remainder split (equal or by units,
  per `split_config`) among the rest, same rounding rule for what's left.
- **`itemized`**: each item's cost divided among its `shared_by` list (equal, unless the
  item specifies exact amounts); tax and tip allocated proportionally to each participant's
  running item subtotal, not split equally — someone who ordered a ₹200 dish shouldn't pay
  the same tax share as someone who ordered ₹800 worth. Same integer-minor-unit rounding
  throughout, remainder absorbed into the largest line item.
- **`reimbursement`**: shares are exact reverse amounts (who owes the payer back) — same
  validation as `exact`, must sum to the total.

## Settlement-plan algorithm (FastAPI, referenced in architecture doc §6)

Also never actually specified until now. Standard greedy debt-simplification, computed
**per currency separately** — balances in different currencies are never netted against
each other (data model principle: currencies aren't silently merged, see `trip_balances`):

1. Read `trip_balances` for the trip, one currency at a time.
2. Split participants into creditors (positive balance, owed money) and debtors (negative).
3. Repeatedly match the largest-magnitude debtor against the largest-magnitude creditor:
   settle `min(|debtor balance|, creditor balance)` as one suggested transaction, reduce
   both by that amount, and repeat until every balance is zero (within a one-minor-unit
   rounding tolerance).
4. Return the resulting list of `{from_participant, to_participant, amount, currency}`
   suggestions — nothing here writes to the ledger; a suggestion only becomes real when
   someone actually calls `record_payment` for it.

Worth being upfront about what this is and isn't: greedy largest-vs-largest is simple, fast,
fully deterministic, and it's what most apps in this space actually ship — but it isn't
guaranteed to produce the mathematically *minimum* possible number of transactions (that's
a harder, NP-hard-in-general problem). "Good and simple" beats "optimal and complex" here;
nobody's going to notice the difference between 4 suggested payments and the theoretical
minimum of 3.

## Worked example: what "elastic" buys you

Say six months in you want **percentage-based splits with a "who's exempt" list** —
something you didn't design for on day one. With this schema that's a `split_config` shape
change, handled entirely inside the `add_expense`/`edit_expense` RPC that interprets it — no
new column, no migration, no client/server schema mismatch to manage.

## Account deletion & data rights

The Splitwise research flags GDPR/CCPA-style deletion rights as a real requirement, and
there's a genuine tension to resolve: **you can't hard-delete a user who still has shared
financial history with other people.**

The resolution: deletion **pseudonymizes, it doesn't cascade-delete.**

- `profiles.id` is never removed while any `participants` row still references it via
  `linked_user_id` — that FK integrity is what keeps everyone else's balances correct.
- `delete_account` scrubs `profiles.display_name` → `"Deleted user"`, clears `avatar_url`,
  and strips the identity's email/phone/OAuth links via Supabase Auth's admin API — without
  touching the `auth.users` row itself.
- Because every `participants` row for a registered user resolves its display name through
  `profiles` (Design Principle 6), nothing about `participants` or the ledger needs to
  change at deletion time — the "Deleted user" label just appears everywhere automatically.
- Same behavior for someone who simply *leaves* a trip — their historical expenses and
  ledger entries stay, only `trip_members.status = 'left'` changes, access is cut, nothing
  is deleted.
