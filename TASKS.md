# Expensio — Task List

Living document. Update this in the same commit as the work it tracks — check something
off, add whatever it revealed, don't let this drift out of sync with what's actually true.
Format: `[x]` done, `[ ]` not started, `[~]` partial (say what's missing).

## Design docs (`docs/architecture/`)

- [x] Architecture (`expensio-architecture.md`)
- [x] Data model (`expensio-data-model.md`)
- [x] Permissions matrix — RLS + RPCs (`expensio-permissions-matrix.md`)
- [x] Onboarding & auth (`expensio-onboarding-auth.md`)
- [x] Trip creation & invite flow (`expensio-trip-creation-flow.md`)
- [x] Monetization (`expensio-monetization.md`)
- [x] Pre-code checklist, kept current (`expensio-pre-code-checklist.md`)
- [x] React Native client setup + DB connection runbook (`expensio-react-native-setup.md`)
- [ ] v1 scope doc — what Expensio v1 actually does vs. deliberately defers. Most valuable
      missing doc; everything so far has been decided incrementally.
- [ ] Notifications doc — schema, event catalog, push vs. email rules, templates.
- [ ] Environments & deployment doc — dev/staging/prod Supabase projects, migration
      tooling, where FastAPI runs, CI/CD.
- [ ] Testing strategy doc — pgTAP for the RPCs at minimum.
- [~] UI port plan (`expensio-ui-port-plan.md`) — porting TripSpend's exact UI onto this
      client; stack/tokens/navigation decisions written up, screen-by-screen mapping still
      has most rows unstarted (see the doc itself)

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
- [ ] Apply against the actual Supabase project and re-run the equivalent checks — local
      Postgres is a stand-in, not identical to Supabase's real `auth.users`/JWKS
- [~] `compute_expense_splits` — 5 of 7 split types fully implemented (equal, exact,
      percentage, shares, reimbursement). `adjustment`'s units-weighted remainder variant
      and `itemized` items with their own exact per-person amounts are explicit judgment
      calls, not implemented — add if a real expense needs them (see the function's own
      comments in `0003_rls_and_rpcs.sql`)
- [ ] Notifications: `notification_events` table, `profiles.notification_preferences`
      column, event-to-template mapping — described in prose (architecture doc §7), never
      turned into DDL
- [ ] Settlement-plan debt-simplification algorithm — designed to live in FastAPI
      (architecture doc §6), not Postgres; FastAPI service doesn't exist yet (see below)

## FastAPI service

- [ ] Not started. Scoped for: settlement-plan suggestions, AI/OCR receipt scanning, other
      heavy logic that doesn't belong in a Postgres RPC (data model doc, profile.md)

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
- [x] Trips list, create trip
- [x] Add expense (equal split only), view expense list
- [x] Activity log tab — the original feature request, working end to end
- [x] Placeholder participants — Members tab, add person, real `paid_by` picker
- [~] TripSpend UI port — NativeWind + navigation + gradient/font foundation in place,
      `AddParticipantScreen` restyled as the first ported screen; see
      `expensio-ui-port-plan.md` for the stack decisions, what's still open, and the
      budget-schema gap blocking `Dashboard`/`TripDetails`
- [x] Edit / delete expense (soft-delete, splits recompute on edit)
- [ ] **Real invites** (`generate_invite` / `join_trip_via_code`) — blocked on
      `is_verified_user()`, which needs phone or Google sign-in. This client only does
      anonymous sign-in. Placeholder participants are the workaround; this is the real
      fix, and it's a substantial feature on its own (Supabase auth config, an OTP screen)
- [ ] Phone OTP or Google sign-in flow (the actual verification step above depends on)
- [ ] `expo-secure-store` for session storage — currently plain `AsyncStorage`
      (`src/supabaseClient.ts`), fine for an anonymous-session spike, not for real auth
- [ ] Non-equal splits UI (exact, percentage, shares, adjustment, itemized) — RPCs and
      server-side math already support all 7; only equal has a picker
- [ ] Balances / settlement view — needs either `ledger_entries` synced + a client-side
      running total, or the FastAPI settlement algorithm above; deliberately not
      half-built, see `expensio-react-native-setup.md`'s scope note
- [x] Archive / unarchive / delete trip UI — options menu on TripDetailScreen (⋯), plus a
      "show archived trips" toggle on the trips list so archiving isn't a one-way trip.
      Caught a real bug building this: `rpc.ts`'s `callRpc` unconditionally added
      `p_client_request_id` to every call, but `archive_trip`/`unarchive_trip`/
      `delete_trip` (and 7 other RPCs) don't declare that parameter at all — would have
      failed outright the first time any of them was called. Fixed with an explicit
      `idempotent` option, default `true`, existing call sites unaffected.
- [ ] Leave trip UI (`leave_trip` RPC exists)
- [ ] Custom categories UI (`add_custom_category` RPC exists; category isn't synced/shown
      on expenses yet either)
- [ ] Expense comments UI (`add_comment` RPC exists; `expense_comments` isn't synced)
- [ ] Expense attachments / photos UI (`add_attachment` RPC exists; needs Supabase Storage
      wiring, `expense_attachments` isn't synced)
- [ ] Recurring expenses UI (`expense_templates`, `generate_due_recurring_expenses` —
      RPC exists, needs a scheduled trigger too, not just UI)
- [ ] Revoke invite / undo-a-recent-join UI (`revoke_invite`, `revoke_recent_join`)
- [ ] `@react-native-community/netinfo` — automatic pending-action flush on reconnect,
      instead of app-launch + manual pull-to-refresh only

## Launch-blockers, not code-blockers

- [ ] Privacy Policy + Terms of Service
- [ ] App store data-safety disclosures (Play Data Safety form, Apple App Privacy label)
- [ ] DLT SMS template registration (OTP template + trip-invite template)
