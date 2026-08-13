# Expensio — PowerSync spike runbook

Companion to `expensio-pre-code-checklist.md`'s call to make this "the literal
first thing built." Code lives in `apps/mobile/` and `supabase/migrations/
0001_powersync_spike.sql`; this doc is the part that can't be committed —
what to click, in what order, and what "it worked" actually looks like.

Scope, deliberately narrow: prove Postgres → PowerSync → local SQLite on a
real Android device works, both directions, including offline. Nothing about
the real schema, RLS, or RPCs is being tested here — that's what
`spike_items`'s wide-open policy is for (see the migration's comments).

## 1. Apply the migration

In the Supabase SQL Editor (or via `supabase db push` if you're using the CLI
against this repo), run `supabase/migrations/0001_powersync_spike.sql`. It
creates `spike_items`, opens it up with an all-access RLS policy, sets
`REPLICA IDENTITY FULL`, and creates a `powersync` publication containing
just that one table.

## 2. Connect Supabase as PowerSync's source database

In the PowerSync dashboard → your instance → **Database Connections**:

1. From your Supabase project's dashboard, click **Connect** → copy the
   **Direct connection** string (hostname should look like
   `db.<ref>.supabase.co`, not the pooler host) and the database password.
2. Paste the connection string into PowerSync's instance **URI** field, add
   the password. PowerSync recommends a dedicated read-only replication
   role rather than the default `postgres` user — fine to skip for this
   spike, worth doing before anything real depends on it.
3. Test the connection.

## 3. Wire up Supabase Auth

Still in the PowerSync instance settings, under **Credentials**: enable
**Use Supabase Auth**. Newer Supabase projects sign tokens asymmetrically —
if there's no shared JWT secret to paste, point PowerSync at your project's
JWKS endpoint instead: `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`.
This is what lets one Supabase session token authenticate both `supabase-js`
calls and the PowerSync connection — no separate token-minting step, matching
`expensio-architecture.md` §6.

## 4. Define what syncs

PowerSync's dashboard will show either **Sync Rules** or **Sync Streams**
depending on which version your instance is running — same underlying idea,
different UI. Define a bucket/stream that selects everything from the spike
table:

```sql
SELECT * FROM spike_items
```

No per-user filtering for this spike — every client gets every row. Deploy
it.

## 5. Configure the client

```bash
cd apps/mobile
cp .env.example .env
```

Fill in `.env`:
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — from Supabase project
  settings → API. Both are client-safe values, not secrets.
- `VITE_POWERSYNC_URL` — your PowerSync instance's endpoint URL, shown on
  its dashboard.

```bash
npm install        # already run once while scaffolding this — rerun after pulling
npx vite build      # produces dist/, which cap sync copies into the native project
npx cap sync android
```

`android/` is already generated and committed — `cap sync` picked up both
native plugins automatically (`@capacitor-community/sqlite`,
`@powersync/capacitor`) last time this was run. `minSdkVersion` is 24,
matching PowerSync's Android floor — no manual edit needed.

## 6. Run it

Open `apps/mobile/android` in Android Studio, let Gradle sync, run on a real
device (not just the emulator — the whole point is validating native SQLite
persistence and a real network path, not the web fallback). First launch
should sign in anonymously, connect, and show an empty list with a text
input.

## 7. What "pass" actually means

Work through all four before calling this settled:

1. **Local write reaches Postgres.** Add an item on the device. Confirm the
   row shows up in Supabase (Table Editor or `select * from spike_items`)
   within a few seconds.
2. **Remote write reaches the device.** Insert a row directly via the
   Supabase SQL Editor. Confirm it appears in the app without touching the
   device.
3. **Offline write survives and syncs later.** Turn on airplane mode, add an
   item — it should appear in the list instantly (that's the local-SQLite
   read, not a round trip). Turn airplane mode back off and confirm it
   reaches Postgres without any manual action.
4. **Kill and relaunch.** Force-stop the app, reopen it. Everything added
   earlier should still be there immediately, before any network activity —
   that's the native-SQLite persistence claim, not just an in-memory cache.

If all four hold: PowerSync's Capacitor SDK is validated for this stack,
proceed with the real schema. If any of them is flaky or the SDK's alpha
status causes real trouble, `expensio-architecture.md` §1 already names the
fallback — a hand-rolled outbox table synced via Supabase Realtime + RPC
calls — as the thing to reach for, not a reason to work around PowerSync
quirks indefinitely.
