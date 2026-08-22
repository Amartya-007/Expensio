# Expensio Notifications

Notifications are server-originated side effects of domain events. The mobile client never
decides whether a notification should be sent: Postgres records the event, and a delivery
worker resolves recipients, preferences, templates, and provider retries.

## Delivery architecture

```text
domain RPC/trigger
      |
      v
notification_events (Postgres queue, one row per domain event)
      |
      v
Edge Function or FastAPI worker
      |
      +--> Expo push service --> FCM/APNs
      +--> transactional email provider
```

The queue is durable and append-only from the domain's perspective. A worker may update
delivery bookkeeping fields, but it must not mutate the financial or membership rows that
caused the event. Delivery is best-effort: a provider outage delays delivery and never
rolls back a successful expense or payment.

## Event catalog

| Event | Source | Recipients | Default channels |
|---|---|---|---|
| `expense_added` | `ledger_entries.entry_type = expense_added` | Active trip members except actor | Push + email |
| `expense_edited` | `trip_activity_log` | Active trip members except actor | Push |
| `expense_deleted` | `ledger_entries.entry_type = expense_deleted` | Active trip members except actor | Push + email |
| `comment_added` | User `expense_comments` insert | Active trip members except actor | Push |
| `payment_recorded` | `ledger_entries.entry_type = payment_recorded` | Recipient and active trip members except actor | Push + email |
| `payment_confirmed` | `ledger_entries.entry_type = payment_confirmed` | Payer and active trip members except actor | Push |
| `member_joined` | `trip_activity_log` | Active trip members except actor | Push |
| `member_rejoined` | `trip_activity_log` | Active trip members except actor | Push |
| `member_left` | `trip_activity_log` | Remaining active trip members | Push |
| `invite_generated` | `trip_activity_log` | No broadcast; worker may send only through an explicit invite action | None |
| `invite_revoked` | `trip_activity_log` | Active trip members except actor | Push |
| `category_added` | `trip_activity_log` | Active trip members except actor | Push |
| `recurring_expense_generated` | `ledger_entries.entry_type = expense_added` with template metadata | Active trip members except actor | Push |

System comments created by `edit_expense` are not separately notified; the corresponding
`expense_edited` event is the single user-facing notification. Attachment uploads are
metadata on an existing expense and do not create a trip-wide notification by default.

## Queue schema contract

The backend migration will create:

```sql
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

alter table profiles add column notification_preferences jsonb not null
  default '{"push": true, "email": true, "digest": false}'::jsonb;
```

`event_key` is deterministic for a domain event, for example
`expense:<expense_id>:added:<ledger_entry_id>`. It prevents duplicate queue rows when a
transaction is retried. The worker uses a short lease on `processing` rows and exponential
backoff for failures. After a bounded number of attempts, a row becomes `failed` and remains
available for operational replay rather than disappearing.

Only active trip members may read notification events for their trip through a narrowly
scoped worker role; the mobile client does not query the queue directly. The worker resolves
the recipient set at delivery time so a member who has since left cannot receive a new event.

## Preferences and templates

The preference object is versioned by keys, with unknown keys ignored safely:

```json
{"push": true, "email": true, "digest": false}
```

Users may update their own preferences through a dedicated RPC. A disabled channel suppresses
only that channel; it does not suppress security or account-recovery messages. v1 templates
are short, factual, and do not include phone numbers, invite secrets, or full receipt data.

Examples:

- Push: `Asha added dinner — ₹1,240 to Goa Trip.`
- Email subject: `New expense in Goa Trip`.
- Push: `Rahul recorded a payment of ₹500.`
- Invite email/SMS: `You were invited to Goa Trip. Join with code 483920.`

The worker may include a deep link to the relevant trip or expense, but the app must still
re-check the current authenticated membership before displaying data.

## Privacy, retention, and operations

- Queue payloads contain identifiers and display-safe summaries, never auth tokens or raw
  receipt images.
- Failed rows are retained for 30 days after their last attempt, then purged by a scheduled
  maintenance job. Audit metadata may be retained longer without message bodies.
- Provider credentials remain in environment secrets. They are never stored in Postgres
  payloads or shipped to the client.
- Metrics include queue age, attempt count, provider response class, and per-channel success
  rate. Logs use event IDs and trip IDs, not phone numbers or access tokens.
