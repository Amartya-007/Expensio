# Expensio — React Native client setup & DB connection

The client is Expo + React Native (see `expensio-architecture.md` §1 for why, over
Capacitor). This doc has grown twice now: first to prove Postgres → PowerSync → local SQLite
works at all (the `spike_items` throwaway table), then again once the real schema and RPCs
existed (`0002_core_schema.sql`, `0003_rls_and_rpcs.sql`) to wire up an actual feature —
create a trip, add an expense, watch its activity log update — instead of a dummy table.
Both layers are covered below; skip to §4 if you already have the spike table's sync rule
working and just need the real one.

Code lives in `apps/mobile/` and `supabase/migrations/`. This doc is the part that can't be
committed: what to click, in what order, and what "it worked" actually looks like.

## 1. Apply the migrations

In the Supabase SQL Editor (or via `supabase db push`), run all three, in order:
`0001_powersync_spike.sql` (the throwaway `spike_items` table — still useful as a quick
connectivity sanity check, separate from the real schema), then `0002_core_schema.sql` and
`0003_rls_and_rpcs.sql` (the actual tables, RLS policies, and RPCs). All three were verified
against a real local PostgreSQL 16 instance before being committed — see `0003`'s commit
message for exactly what was tested and what wasn't (Supabase's real `auth.users`/JWKS
weren't part of that local verification, applying to your actual project is the next real
checkpoint).

## 2. Connect Supabase as PowerSync's source database

In the PowerSync dashboard → your instance → **Database Connections**:

1. From Supabase's dashboard, click **Connect** → copy the **Direct connection** string
   (hostname like `db.<ref>.supabase.co`, not the pooler) and the database password.
2. Paste into PowerSync's instance **URI** field, add the password. A dedicated read-only
   replication role is recommended over the default `postgres` user — fine to skip for this
   spike, worth doing before anything real depends on it.
3. Test the connection.

## 3. Wire up Supabase Auth

Same instance settings, under **Credentials**: enable **Use Supabase Auth**. If your project
signs tokens asymmetrically (no shared JWT secret to paste), point PowerSync at the JWKS
endpoint instead: `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`. This lets
one Supabase session token authenticate both `supabase-js` calls and the PowerSync connection —
matches `expensio-architecture.md` §6.

## 4. Define what syncs

**Correction, found the hard way:** an earlier version of this doc claimed Sync Rules and
Sync Streams "share the same underlying format" — that was wrong, and cost real
troubleshooting time. They're genuinely different YAML schemas. Sync Rules uses
`bucket_definitions:` with separate `parameters:`/`data:` blocks, where one bucket can sync
several different tables and joins are only allowed in the parameter query. Sync Streams —
the current default, what a `sync_streams.yaml` tab in the dashboard means — uses `streams:`
with a single `query:` per stream, JOINs allowed directly in that query, and each stream
syncs rows from one table. What was one Sync Rules bucket covering 4 tables became 4
separate streams.

Paste in `supabase/powersync/sync-streams.yaml` from this repo — 5 streams (`user_trips`,
`user_trip_participants`, `user_trip_expenses`, `user_trip_activity_log`,
`user_expense_splits`), each scoped to trips you're an active member of via a JOIN against
`trip_members`, each with `auto_subscribe: true` so it syncs automatically on connect — the
client doesn't call any explicit subscription API, so without `auto_subscribe: true` nothing
would sync at all. Deploy it.

If `auth.user_id()` doesn't resolve (some instance versions may still expect
`request.user_id()` — check whatever the dashboard's own inline docs/examples show for your
specific instance before assuming one or the other), swap it in all 5 queries. Either way,
this still depends on step 3's Supabase Auth / JWKS setup being done — that's what lets the
function resolve to the signed-in user's id.

## 5. Install and configure the client

```bash
cd apps/mobile
npm install
cp .env.example .env
```

Fill in `.env`:
- `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` — Supabase project settings →
  API. Both are client-safe values, not secrets.
- `EXPO_PUBLIC_POWERSYNC_URL` — your PowerSync instance's endpoint, shown on its dashboard.

Expo inlines any `EXPO_PUBLIC_*` variable from `.env` into the bundle at build time — restart
the Metro bundler after editing `.env`, since it isn't live-reloaded.

**Why Expo + these specific packages**, if you're comparing against other PowerSync setup
guides: `@op-engineering/op-sqlite` is the native SQLite binding PowerSync uses on React
Native (the older `@journeyapps/react-native-quick-sqlite` path is no longer the default).
`@azure/core-asynciterator-polyfill` plus the `@babel/plugin-transform-async-generator-functions`
Babel plugin (already wired into `babel.config.js`) are required for PowerSync's watched
queries — without them you'll hit `TypeError: Cannot read properties of undefined
(reading 'transformFile')` or similar obscure Metro errors, not an obviously-relevant one.

## 6. Run it

This app uses native modules (OP-SQLite), so **Expo Go won't work** — it needs a custom dev
build:

```bash
npx expo run:android
```

First run builds a native Android project (via Expo prebuild) and installs it on a connected
device or emulator — real device strongly preferred, since the whole point is validating
native SQLite persistence and a real network path, not a simulator's. Xcode/`npx expo
run:ios` works the same way whenever iOS gets un-deferred; nothing about this setup is
Android-specific.

If Metro complains about a missing Babel plugin or preset, it's almost always one of
`babel-preset-expo` or the async-generator plugin not being hoisted to the top-level
`node_modules` — run `npm ls babel-preset-expo` and reinstall as a direct devDependency if it's
only showing up nested under another package.

## 7. Two ways to test it: the spike table, and the real feature

**Quick connectivity check (optional, if you haven't already):** same four checks as
before, just against `spike_items` — add an item, confirm it reaches Postgres; insert one
via the SQL Editor, confirm it reaches the device; test offline-then-reconnect; force-quit
and relaunch. This isolates "is the sync pipe itself working" from "does the real app logic
work," which is worth keeping separate if something goes wrong.

**The real feature — this is what to actually put in front of someone:**

1. **Sign in and create a trip.** App opens, signs in anonymously, shows an empty trip list.
   Tap **+ New Trip**, name it, pick a currency, create it. It should appear in the list
   within a couple seconds (round-tripped through `create_trip` → Postgres → PowerSync →
   back down).
2. **Add an expense.** Open the trip, tap **+ Add Expense**, add one. It calls `add_expense`
   directly — `compute_expense_splits` runs server-side, so the split math (equal split, for
   this first slice) is happening for real, not simulated client-side.
3. **Edit it, then delete it.** Tap the expense to open it, tap **Edit**, change the amount,
   **Save** — the split line should update to match. Back on the expense, tap **Delete** and
   confirm. It should disappear from the Expenses tab immediately, but check the Activity
   Log tab: both the edit and the delete should be there permanently — deleting an expense
   doesn't erase its history, only the expense itself (soft-deleted, not a real `DELETE` —
   `expensio-pre-code-checklist.md` explains why).
4. **Add a person and split an expense with them.** Members tab → **+ Add Person** → give
   them a name. Add another expense and tap their chip in the **Paid by** row instead of
   your own — then check the expense's split line (under the amount) shows both of you
   owing a share. This is the placeholder-participant path — no second device or account
   needed to test real multi-person splitting.
5. **Check the Activity Log tab.** This is the feature the whole project started from
   (`trip_created`, `expense_added`, `expense_edited`, `expense_deleted` should all be there
   by now) — confirm it's populating, and that it reads back correctly after a force-quit
   and relaunch (immutability + persistence, both for real).
6. **Offline test.** Airplane mode on, add another expense. It won't appear in the list (see
   "Why writes don't show up instantly offline" below) — instead the trips list should show
   a small "N changes waiting to sync" banner. Airplane mode off, pull down to refresh: the
   banner should clear and the expense should appear.
7. **Two-device or two-session cross-check**, if you can: open the same trip on a second
   device/emulator (or a second Supabase anonymous session) and confirm an expense added on
   one appears on the other without any manual action.

## Why writes don't show up instantly offline (a real design choice, not a bug)

The spike used PowerSync's default pattern: local writes go into its own CRUD queue, and a
connector uploads them by mirroring each INSERT/UPDATE/DELETE onto the matching Postgres
table. That doesn't work here — a real expense needs `compute_expense_splits`, a
`trip_activity_log` entry, and a `ledger_entries` row, none of which a raw table write can
produce. So real writes (`src/rpc.ts`) call the RPC directly instead of going through
PowerSync's queue at all. Online, this is invisible — the RPC runs immediately and the
result syncs back down in about as long as the spike's writes took. Offline, there's a real
trade-off: rather than fake an optimistic local copy of a split calculation the client
doesn't actually know how to do correctly, a queued action just waits (visibly, via the
pending-count banner) until it can run for real. `src/AppSchema.ts`'s comment block and
`src/rpc.ts` have the full reasoning — worth reading before extending this pattern to a new
screen.

## Known gaps, flagged rather than left silent

- **Session storage:** `src/supabaseClient.ts` uses plain `AsyncStorage`, not the
  `expo-secure-store` that `expensio-onboarding-auth.md` §8 specifies for the real app.
  Swap it in before any real auth flow (phone OTP, Google) is built on top of this.
- **No network-state listener.** Queued actions replay on app launch and on manual
  pull-to-refresh (`src/rpc.ts`), not automatically the instant connectivity returns — add
  `@react-native-community/netinfo` and a listener if that matters for real usage.
- **This slice's scope is still narrow, but less than before:** placeholder participants
  (people without the app) can now be added and picked as who-paid — see the Members tab
  and the `paid_by` picker in Add Expense. Tapping an expense now opens it for editing or
  deleting too (`ExpenseDetailScreen`). Still missing: non-equal splits, and a settlement/
  balances view — the latter would need either duplicating the settlement-simplification
  algorithm client-side (deliberately left to a not-yet-built FastAPI service per
  `expensio-architecture.md` §6) or syncing `ledger_entries` and building a simpler running
  total; worth its own pass rather than a quick addition here.
- **Real invites (`generate_invite`/`join_trip_via_code`) are deliberately not wired up
  yet, and won't work if you try to call them from this client as-is.** Both RPCs require
  `is_verified_user()` (permissions-matrix doc — phone or Google sign-in, not anonymous),
  and this client only does anonymous sign-in (`App.tsx`). Placeholder participants are the
  workaround that needs zero new auth work; a real verification flow is a substantial
  feature of its own (Supabase phone/SMS or Google OAuth setup on your project, an OTP
  screen) — worth its own pass, not something to bolt on silently alongside everything
  else here.
