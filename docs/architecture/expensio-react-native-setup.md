# Expensio — React Native client setup & DB connection

Supersedes the earlier Capacitor-based `expensio-powersync-spike.md` (removed — the client
was rebuilt on Expo + React Native, see `expensio-architecture.md` §1 for why). Same goal as
before: prove Postgres → PowerSync → local SQLite on a real device works, both directions,
including offline, before any real feature code is built on top of it.

Code lives in `apps/mobile/` and `supabase/migrations/0001_powersync_spike.sql` (unchanged —
the backend doesn't care which client framework talks to it). This doc is the part that can't
be committed: what to click, in what order, and what "it worked" actually looks like.

## 1. Apply the migration

In the Supabase SQL Editor (or via `supabase db push`), run
`supabase/migrations/0001_powersync_spike.sql`. Creates a throwaway `spike_items` table with
an open RLS policy, `REPLICA IDENTITY FULL`, and its own `powersync` publication — deliberately
not the real schema, see `expensio-pre-code-checklist.md`.

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

PowerSync's dashboard shows either **Sync Rules** or **Sync Streams** depending on your
instance version — same idea. Define a bucket/stream:

```sql
SELECT * FROM spike_items
```

No per-user filtering for this spike. Deploy it.

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

## 7. What "pass" actually means

Work through all four before calling this settled:

1. **Local write reaches Postgres.** Add an item on the device. Confirm the row shows up in
   Supabase (Table Editor or `select * from spike_items`) within a few seconds.
2. **Remote write reaches the device.** Insert a row directly via the Supabase SQL Editor.
   Confirm it appears in the app without touching the device.
3. **Offline write survives and syncs later.** Airplane mode on, add an item — it should appear
   in the list instantly (local-SQLite read, not a round trip). Airplane mode off, confirm it
   reaches Postgres without any manual action.
4. **Kill and relaunch.** Force-stop the app, reopen it. Everything added earlier should be
   there immediately, before any network activity — that's the native-SQLite persistence
   claim, not an in-memory cache.

If all four hold: the React Native SDK is validated for this stack, proceed with the real
schema. `expensio-architecture.md` §1 already names the fallback (a hand-rolled outbox table
synced via Supabase Realtime + RPC calls) if real trouble shows up — though this SDK's had two
years longer to mature than the Capacitor one this project started on, so that's less likely
to be needed than it was before.

## Known gap: session storage

`src/supabaseClient.ts` uses plain `AsyncStorage` for the Supabase session — fine for this
throwaway anonymous-session spike (same "test sync, not security" scope as `spike_items`'
wide-open RLS policy), but `expensio-onboarding-auth.md` §8 specifies `expo-secure-store`
(Keychain/Keystore-backed) for the real app. Swap it in before any real auth flow (phone OTP,
Google) gets built on top of this.
