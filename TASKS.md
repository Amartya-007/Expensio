# Expensio — Task List

Living document. Update this in the same commit as the work it tracks — check something
off, add whatever it revealed, don't let this drift out of sync with what's actually true.
Format: `[x]` done, `[ ]` not started, `[~]` partial (say what's missing).

*A large batch of independent work ("New screen and FastAPI", 3 commits) landed directly
on GitHub between two sessions in this chat, without this file being updated alongside it.
The entries below marked done/partial from that batch were confirmed by reading the actual
diffs and grepping the resulting code in this session — not just inferred from commit
messages or file names — but weren't exercised against a running app (no
device/simulator in this environment). Worth an actual run-through before trusting them
fully.*

## Design docs (`docs/architecture/`)

- [x] Architecture (`expensio-architecture.md`)
- [x] Data model (`expensio-data-model.md`)
- [x] Permissions matrix — RLS + RPCs (`expensio-permissions-matrix.md`)
- [x] Onboarding & auth (`expensio-onboarding-auth.md`)
- [x] Trip creation & invite flow (`expensio-trip-creation-flow.md`)
- [x] Monetization (`expensio-monetization.md`)
- [x] Pre-code checklist, kept current (`expensio-pre-code-checklist.md`)
- [x] React Native client setup + DB connection runbook (`expensio-react-native-setup.md`)
- [x] v1 scope doc (`expensio-v1-scope.md`)
- [x] Notifications doc (`expensio-notifications.md`)
- [x] Environments & deployment doc (`expensio-environments-deployment.md`)
- [x] Testing strategy doc (`expensio-testing-strategy.md`) — pgTAP tests now exist too,
      see below
- [~] UI port plan (`expensio-ui-port-plan.md`) — porting TripSpend's exact UI onto this
      client; stack/tokens/navigation decisions written up, `AddParticipantScreen` and
      `ExpenseDetailScreen` ported, most of the screen-by-screen mapping still unstarted
      (see the doc itself)

## Backend — schema, RLS, RPCs (`supabase/migrations/`)

- [x] `0001_powersync_spike.sql` — throwaway table, proved the sync pipe works
- [x] `0002_core_schema.sql` — real schema: trips, trip_members, trip_invites,
      participants, expenses, expense_splits, expense_templates, expense_attachments,
      expense_comments, custom_categories, ledger_entries, trip_activity_log,
      processed_requests. Immutability trigger on the activity log.
- [x] `0003_rls_and_rpcs.sql` — RLS policies on every table, ~20 RPCs, `compute_expense_splits`
      (written from scratch — referenced by name everywhere but never actually specified
      until this), idempotency-replay fix (`processed_requests.result`), duplicate-phone
      placeholder fix
- [x] Verified against a real local PostgreSQL 16 instance — schema apply, RLS genuinely
      enforced (not superuser-bypassed), cross-trip isolation, all 7 split types, idempotent
      replay, immutability (both as a defense layer and via trigger), join/leave/rejoin
      history, placeholder-claim security, edit/delete
- [x] Corrected 5 real bugs the first verification pass missed (all caught because it
      manually seeded `auth.users` + `profiles` together, never exercising a real signup):
      real tables never added to the `powersync` publication (would've synced nothing),
      no trigger to populate `profiles` on signup (`create_trip` would've silently failed
      to add its own creator as a participant), RLS missing entirely on 4 tables including
      one that leaked invite codes across users, two overly-permissive `trips` policies
      that bypassed the RPC-only design, and `search_path` hardening missing on every
      `SECURITY DEFINER` function. Full regression suite re-run clean afterward.
- [x] `0004_notifications.sql` — `notification_events` table, `profiles.notification_preferences`
      column. Confirmed the DDL exists; actual event-to-template mapping / send logic not
      re-verified this session.
- [x] `0005_backend_correctness.sql` (757 lines) — `compute_expense_splits` rewritten with
      proper decimal→minor-unit money handling (`money_to_minor`), and now genuinely covers
      all 7 split types including `adjustment`/`itemized` (confirmed by reading the
      function body, not just the migration's existence). Also adds participant-aware
      ledger entries (`insert_expense_ledger_entries`/`reverse_expense_ledger_entries`,
      with a backfill for pre-existing expenses) and payment-recording RPCs
      (`record_payment`, `confirm_payment`) — the backend half of settlement.
- [ ] Apply against the actual Supabase project and re-run the equivalent checks — local
      Postgres is a stand-in, not identical to Supabase's real `auth.users`/JWKS. Also now
      needs to cover 0004/0005, not just 0002/0003.
- [x] `compute_expense_splits` — all 7 split types (equal, exact, percentage, shares,
      reimbursement, adjustment, itemized) implemented as of `0005_backend_correctness.sql`
- [ ] Settlement-plan debt-simplification algorithm — `record_payment`/`confirm_payment`
      exist (manual payment recording), but the actual debt-simplification/suggestion
      algorithm (architecture doc §6) is still scoped for FastAPI, not found in this batch

## FastAPI service (`services/api/`)

- [~] Scaffolded — `main.py`, `auth.py`, `models.py`, `repository.py`, `settlement.py`,
      `pyproject.toml`, plus a pytest suite (`tests/test_api.py`, `test_auth.py`,
      `test_settlement.py`). Structure and test files confirmed to exist; haven't run the
      suite or reviewed `settlement.py`'s actual algorithm in depth this session.

## Mobile client (`apps/mobile/`) — React Native + Expo

- [x] Capacitor → React Native/Expo conversion, PowerSync spike re-validated on the new stack
- [x] Real per-user PowerSync sync — `supabase/powersync/sync-streams.yaml` (Sync Streams
      format; corrected from an initial version wrongly assuming it was interchangeable
      with the older Sync Rules `bucket_definitions:` format — different YAML schema
      entirely, found when the dashboard rejected it) — trips, participants, expenses,
      expense_splits, trip_activity_log
- [x] RPC-first write architecture (`src/rpc.ts`) — real writes bypass PowerSync's CRUD
      queue (can't produce split/ledger/activity-log side effects), call RPCs directly
      instead; local-only `pending_actions` table is the offline fallback
- [x] Anonymous sign-in, connect, initial sync
- [x] `@react-native-community/netinfo` — pending-action flush now fires automatically on
      reconnect (`App.tsx`), not just app-launch/manual pull-to-refresh
- [x] `expo-secure-store` for session storage — replaced plain `AsyncStorage`
      (`src/supabaseClient.ts`) with a Keychain/Keystore-backed adapter
- [x] Trips list, create trip
- [x] Add expense — all 7 split types now have a picker (`AddExpenseScreen.tsx`); was
      equal-only before this batch
- [x] View expense list, activity log tab
- [x] Placeholder participants — Members tab, add person, real `paid_by` picker
- [x] Edit / delete expense (soft-delete, splits recompute on edit)
- [x] Expense comments UI (`ExpenseDetailScreen.tsx`) — comment list + composer,
      `add_comment` RPC. Landed on the old unstyled version of the screen in the same
      batch as the rest of this section; merged into the restyled version by hand this
      session (see `expensio-ui-port-plan.md`)
- [x] **Real invites** (`InviteScreen.tsx`) — `generate_invite`, `join_trip_via_code`,
      `revoke_invite` all wired
- [x] Phone verification (`PhoneVerificationScreen.tsx`) — Supabase Auth `verifyOtp`
      (`type: 'phone_change'`) linking a phone number to the anonymous session, satisfying
      `is_verified_user()` for real invites above
- [~] Balances / settlement view (`SettlementScreen.tsx`) — displays balances; no
      `record_payment`/`confirm_payment` call found in the screen, so recording an actual
      payment isn't wired into the UI yet even though both RPCs exist
      (`0005_backend_correctness.sql`)
- [~] Recurring expenses UI (`RecurringScreen.tsx`) — create/delete template wired
      (`create_expense_template`, `delete_expense_template`); the scheduled-trigger side
      (`generate_due_recurring_expenses` actually firing on a schedule, not just existing
      as an RPC) not confirmed this session
- [x] Leave trip UI (`TripDetailScreen.tsx`'s options menu, `leave_trip` RPC)
- [~] TripSpend UI port — NativeWind + navigation + gradient/font foundation in place;
      `AddParticipantScreen` and `ExpenseDetailScreen` restyled. See
      `expensio-ui-port-plan.md` for stack decisions, the full screen-by-screen mapping,
      and the budget-schema gap blocking `Dashboard`/`TripDetails`
- [x] Archive / unarchive / delete trip UI — options menu on TripDetailScreen (⋯), plus a
      "show archived trips" toggle on the trips list so archiving isn't a one-way trip.
      Caught a real bug building this: `rpc.ts`'s `callRpc` unconditionally added
      `p_client_request_id` to every call, but `archive_trip`/`unarchive_trip`/
      `delete_trip` (and 7 other RPCs) don't declare that parameter at all — would have
      failed outright the first time any of them was called. Fixed with an explicit
      `idempotent` option, default `true`, existing call sites unaffected.
- [x] Custom category data now synced/shown — `category` and `expense_date` added to
      `ExpenseDetailScreen`'s query this session; both already existed on `expenses` and
      in `add_expense`'s RPC signature, just weren't being read before
- [ ] Custom categories *management* UI (`add_custom_category` RPC exists; no
      CategoryManager-equivalent screen in this batch)
- [ ] Expense attachments / photos UI (`add_attachment` RPC exists; needs Supabase Storage
      wiring, `expense_attachments` isn't synced)
- [ ] Revoke-recent-join UI (`revoke_recent_join` RPC exists; not found called from any
      screen this session — `revoke_invite` above is a different RPC, already wired)

## Testing

- [x] pgTAP suite (`supabase/tests/`) — `0000_test_helpers.sql` through
      `0004_notifications.sql`, covering core invariants, split math, RPC permissions,
      notifications
- [~] FastAPI pytest suite (`services/api/tests/`) — exists, not run this session

## Launch-blockers, not code-blockers

- [ ] Privacy Policy + Terms of Service
- [ ] App store data-safety disclosures (Play Data Safety form, Apple App Privacy label)
- [ ] DLT SMS template registration (OTP template + trip-invite template)
