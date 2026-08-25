# Expensio — Task List

Living document. Update this in the same commit as the work it tracks — check something
off, add whatever it revealed, don't let this drift out of sync with what's actually true.
Format: `[x]` done, `[ ]` not started, `[~]` partial (say what's missing).

*A large batch of independent work ("New screen and FastAPI", 3 commits) landed directly
on GitHub between two sessions in this chat, without this file being updated alongside it.
The user made these commits directly, not another chat session. A follow-up review pass
went further than reading diffs: installed Postgres and the FastAPI service for real,
ran the actual migrations and test suites, and found three real bugs in the process —
`0005_backend_correctness.sql` didn't apply at all (missing `perform` keywords),
`record_payment` had its debt math backwards, and `0004`'s notification dedup could
silently drop a real notification. All three fixed and re-verified; see their entries
below for details. What's still NOT been exercised: the actual mobile app on a
device/simulator (still no device/simulator in this environment) — RPC-level and
SQL-level correctness is now solid, but nothing above confirms the UI actually renders
or behaves right on a real phone.*

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
      column. Fixed a real bug this session: the upsert on a repeated `event_key` merged
      the payload but never reset `status`/`attempts`/`next_attempt_at`, so a second
      occurrence of the same event (e.g. editing the same expense twice) would silently
      vanish if the first one had already been sent — nothing would re-queue it. Event-to-
      template mapping / actual send logic still not built (no worker exists yet).
- [x] `0005_backend_correctness.sql` (757 lines) — `compute_expense_splits` rewritten with
      proper decimal→minor-unit money handling (`money_to_minor`), covering all 7 split
      types including `adjustment`/`itemized`. Also adds participant-aware ledger entries
      (`insert_expense_ledger_entries`/`reverse_expense_ledger_entries`, with a backfill
      for pre-existing expenses) and payment-recording RPCs (`record_payment`,
      `confirm_payment`) — the backend half of settlement.
      **Fixed two real bugs this session, both confirmed against a real local Postgres 16
      instance, not just by reading the SQL:**
      1. The migration didn't apply at all. `compute_expense_splits` calls
         `validate_split_participant_map`/`validate_weight_map` nine times, every one of
         them missing the `perform` keyword PL/pgSQL requires for a bare void-function-call
         statement — confirmed with an isolated repro, then fixed all nine. Since that
         function failed to even get created, everything after it in the file (the ledger
         functions, `add_expense`/`edit_expense`/`delete_expense`, both payment RPCs) would
         never have been created either.
      2. `record_payment` had the debt math backwards. Traced through with real numbers:
         Bob owes Alice ₹50; Bob calls `record_payment` to pay Alice ₹50; balances went to
         -100/+100 instead of 0/0 — recording a payment made the imbalance *worse*. Root
         cause: `trip_balances` treats `from_participant` as "this balance goes down",
         which is right for an expense (from=debtor) but wrong for a payment (the payer's
         balance should go *up*). Fixed by negating the stored amount rather than swapping
         which participant occupies which column, so `confirm_payment`'s "only the
         recipient can confirm" check didn't need to change — re-verified that check still
         rejects the payer and accepts the actual recipient after the fix.
      Full add_expense → record_payment → confirm_payment flow re-run clean after both
      fixes (balances settle to exactly 0.00, `exact`-split type also spot-checked).
- [ ] Apply against the actual Supabase project and re-run the equivalent checks — local
      Postgres is a stand-in, not identical to Supabase's real `auth.users`/JWKS. Also now
      needs to cover 0004/0005, not just 0002/0003 — **and per the above, 0005 as
      originally committed would have failed outright**, so this is more than a formality.
- [x] `compute_expense_splits` — all 7 split types (equal, exact, percentage, shares,
      reimbursement, adjustment, itemized) implemented as of `0005_backend_correctness.sql`
- [x] Settlement-plan debt-simplification algorithm — `services/api/app/settlement.py`,
      a greedy largest-debtor-to-largest-creditor matcher (not minimum-transaction-count
      optimal, which is NP-hard in general, but a standard reasonable approach). Covered by
      real passing tests (`test_settlement.py`), not just present

## FastAPI service (`services/api/`)

- [x] Scaffolded, and the scaffolding is genuinely solid — installed it in a real venv
      and ran the actual pytest suite this session (not just confirmed the files exist):
      all 10 tests pass. `settlement.py`'s debt-simplification algorithm reviewed in
      depth (see the note under `0005`'s entry above) — real, working code, not a stub.

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
      `is_verified_user()` for real invites above. Fixed a real bug this session: the
      optional post-verification `update_display_name` call shared the same try/catch as
      `verifyOtp` itself, so a failure there (e.g. a network hiccup) left the user staring
      at an error on the OTP screen for a phone number that had, in fact, already been
      successfully verified. Now best-effort and non-blocking — `onDone()` always fires
      once `verifyOtp` succeeds.
- [~] Balances / settlement view (`SettlementScreen.tsx`) — displays balances via the
      FastAPI settlement-plan endpoint (correctly read-only by design, not a gap); no
      `record_payment`/`confirm_payment` call wired into the UI yet even though both RPCs
      exist and are now confirmed correct (`0005_backend_correctness.sql`'s entry above)
- [~] Recurring expenses UI (`RecurringScreen.tsx`) — create/delete template wired
      (`create_expense_template`, `delete_expense_template`, params confirmed to match
      both RPC signatures exactly); the scheduled-trigger side
      (`generate_due_recurring_expenses` actually firing on a schedule, not just existing
      as an RPC) not confirmed this session
- [x] Leave trip UI (`TripDetailScreen.tsx`'s options menu, `leave_trip` RPC). Minor,
      non-blocking cosmetic note found while reviewing this screen: the "Settle" tab is
      styled identically to the three real in-place tabs (Expenses/Log/Members) but
      actually navigates to a separate screen rather than switching content locally, and
      the `'settlement'` value in the tab-state type is consequently never set by
      anything — dead code, not a functional bug, but worth a look if this screen gets
      touched again; whether "Settle" should be a real fourth tab or stay a separate
      screen is a product call, not something to silently change
- [~] TripSpend UI port — NativeWind + navigation + gradient/font foundation in place;
      `AddParticipantScreen`, `ExpenseDetailScreen`, `AddExpenseScreen`, and
      `TripDetailScreen` (all three tabs) restyled. See `expensio-ui-port-plan.md` for
      stack decisions, the full screen-by-screen mapping, and the budget-schema gap
      blocking `Dashboard`/`TripDetails`. Still open: `SettlementScreen`,
      `InviteScreen`, `PhoneVerificationScreen`, `RecurringScreen`, and the
      navigation-shape decision (persistent tab bar vs. current drill-in nav)
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
- [x] FastAPI pytest suite (`services/api/tests/`) — actually run this session (real venv,
      real `pip install -e .[test]`), all 10 pass

## Launch-blockers, not code-blockers

- [ ] Privacy Policy + Terms of Service
- [ ] App store data-safety disclosures (Play Data Safety form, Apple App Privacy label)
- [ ] DLT SMS template registration (OTP template + trip-invite template)
