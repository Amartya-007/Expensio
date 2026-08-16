import { Schema, Table, column } from '@powersync/react-native';

// Real Expensio tables, matching supabase/migrations/0002_core_schema.sql and the
// bucket definitions in supabase/powersync/sync-rules.yaml. PowerSync SQLite columns
// are text/real/integer only — uuid/timestamptz map to text, numeric to real, jsonb to
// text (parsed with JSON.parse where read). Scope matches the sync rules: trips,
// participants, expenses, expense_splits, trip_activity_log. Everything else
// (custom_categories, trip_invites, comments, attachments, ledger_entries,
// expense_templates) isn't synced yet — see sync-rules.yaml's header for why, and add a
// Table here to match whenever a bucket is added for it.
export const AppSchema = new Schema({
  trips: new Table({
    name: column.text,
    currency: column.text,
    created_by: column.text,
    start_date: column.text,
    end_date: column.text,
    is_archived: column.integer,
    created_at: column.text,
  }),

  participants: new Table({
    trip_id: column.text,
    type: column.text,
    linked_user_id: column.text,
    display_name: column.text,
    phone: column.text,
    created_at: column.text,
  }),

  expenses: new Table({
    trip_id: column.text,
    description: column.text,
    amount: column.real,
    currency: column.text,
    paid_by: column.text,
    category: column.text,
    expense_date: column.text,
    split_type: column.text,
    created_by: column.text,
    created_at: column.text,
    // Soft-delete marker (0002_core_schema.sql) — delete_expense sets this rather than
    // removing the row, so every query against this table needs to filter
    // "WHERE deleted_at IS NULL" itself. Missing this filter was caught before it shipped:
    // see TripDetailScreen.tsx's expense query.
    deleted_at: column.text,
  }),

  expense_splits: new Table({
    expense_id: column.text,
    participant_id: column.text,
    share_amount: column.real,
  }),

  trip_activity_log: new Table({
    trip_id: column.text,
    event_type: column.text,
    actor_id: column.text,
    subject_participant_id: column.text,
    description: column.text,
    created_at: column.text,
  }),

  // LOCAL-ONLY — never syncs to Postgres. Real writes (create_trip, add_expense, ...) call
  // their RPC directly via supabase.rpc(), not through PowerSync's CRUD upload queue —
  // see src/rpc.ts for why. This table is purely the offline fallback: an action queued
  // here when an RPC call fails for lack of connectivity, replayed by flushPendingActions()
  // once the connection comes back. Nothing in the schema below this point is server data.
  pending_actions: new Table(
    {
      rpc_name: column.text,
      params_json: column.text,
      client_request_id: column.text,
      created_at: column.text,
    },
    { localOnly: true }
  ),
});

export type Database = (typeof AppSchema)['types'];
