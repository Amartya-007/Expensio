# Expensio — System Architecture

## 0. Scope & assumptions made in this doc

Your brief said "Database: Supabase Postgres or clerk." Clerk is an auth provider, not a
database, and your stack line separately says "Auth: Supabase Auth" — so I've assumed that
was a slip and designed around **Supabase Auth** throughout. It has native phone-OTP and
Google OAuth support (see `expensio-onboarding-auth.md` for the full sign-up flow), which is
what this design needs, without a token-exchange layer to another provider. If you actually
want Clerk for a specific reason (e.g. existing org-wide identity, better MFA/SSO), say so —
it's possible to wire Clerk JWTs into Supabase as a third-party auth provider, but I don't
see a benefit here.

Everything below assumes the goals from your brief: offline-first with sync, real-time
collaboration, strong access control, a schema that doesn't need to be redesigned when you
add features, and clean separation between client / database / server logic.

---

## 1. Stack

| Layer | Choice | Role |
|---|---|---|
| Client | React + TypeScript + Capacitor | UI, local SQLite, offline reads/writes |
| Local DB | SQLite via **PowerSync Capacitor SDK** | on-device source of truth, works offline |
| Sync engine | **PowerSync** | streams Postgres ⇄ local SQLite, handles the upload queue |
| Backend DB | **Supabase Postgres** | source of truth, RLS, RPC functions, realtime (via logical replication, consumed by PowerSync) |
| Auth | **Supabase Auth** — mandatory phone OTP + Google OAuth | every account is phone-verified before first use, see §3 |
| Storage | Supabase Storage | receipt images, RLS-protected by trip membership |
| Server | **FastAPI** | OCR, AI suggestions, settlement-optimization — stateless helper, never the source of truth for money |

I checked current status before recommending PowerSync: it now ships an official
`@powersync/capacitor` package (native SQLite on iOS/Android via `@capacitor-community/sqlite`,
WA-SQLite/IndexedDB on web, same API across both) — as of early 2026 it's still labeled
alpha/beta. That's the one real risk in this stack: pin versions, and prototype the sync
path early (week one, not week ten) so you find any rough edges before the rest of the app
is built on top of it. If it turns out to be too unstable in practice, the fallback is a
hand-rolled outbox table synced via Supabase Realtime + RPC calls — more work, but zero
third-party risk. I'd only reach for that fallback if PowerSync's Capacitor SDK actually
gives you trouble; don't pre-build both.

---

## 2. Layered architecture

```
┌─────────────────────────────────────────────────────────┐
│ CLIENT  (React + TS + Capacitor)                         │
│                                                           │
│  UI  →  Local SQLite (PowerSync)  ←→  PowerSync sync      │
│                                          engine            │
│  UI  →  supabase-js  →  Auth, Storage, RPC calls          │
│         (used for anything sensitive — never raw table    │
│          writes on trips/members/expenses)                │
└───────────────────────────┬───────────────────────────────┘
                             │ Postgres logical replication
                             ▼
┌─────────────────────────────────────────────────────────┐
│ DATABASE  (Supabase Postgres)                             │
│                                                           │
│  Tables (trips, trip_members, expenses, expense_splits,   │
│          ledger_entries, trip_invites)                    │
│  RLS policies — membership checks, defense in depth        │
│  RPC functions (SECURITY DEFINER) — the ONE place          │
│          business rules live: join, invite, remove,       │
│          add/edit/delete expense, record/confirm payment  │
│  Realtime / WAL — feeds PowerSync                          │
│  Storage buckets — receipts                                │
└───────────────────────────┬───────────────────────────────┘
                             │ scoped DB role / RPC calls
                             ▼
┌─────────────────────────────────────────────────────────┐
│ SERVER  (FastAPI)                                          │
│                                                           │
│  POST /ocr/receipt          → parse a receipt image        │
│  POST /suggest/category     → AI categorization             │
│  GET  /trip/{id}/settlement-plan → debt-simplification      │
│                                                           │
│  Reads trip_balances view; never writes financial state    │
│  directly — proposes, client confirms via RPC              │
└─────────────────────────────────────────────────────────┘
```

**The rule that makes this "clean separation" instead of just three boxes:** every write
that touches money, membership, or invites goes through a Postgres RPC function, never a
raw `INSERT`/`UPDATE` from the client. RLS stays on as defense in depth, but the actual
business logic — "can this user join," "can this user remove that user," "how do we split
this expense" — lives in exactly one place, in Postgres, where it's testable with pgTAP and
can't drift between client code and rules the way TripSpend's did.

---

## 3. Local mode and collaborative mode are the same shape

TripSpend's worst bug came from local trips and cloud trips being *different data shapes*
that had to be translated at the exact moment a person tried to go collaborative — and that
translation silently dropped the ownership link. Expensio avoids the translation entirely,
by making sure it never happens: **every user completes sign-up and phone verification
before they can create a trip at all** — see `expensio-onboarding-auth.md` for the full
flow. There is no anonymous/local-only identity that later needs upgrading.

- A "local, single-person" trip is just a trip with one `trip_members` row and no active
  invite. There is no separate local schema — solo and collaborative trips are the same
  table shape from the start.
- Because the account (and its `user_id`) exists *before* any trip data does, there is no
  moment where local data has to be re-owned to a different identity. The migration bug
  class doesn't get a foothold because there's no migration step in the design at all.
- Offline-first is still the default for everyone, solo or collaborative — that's a property
  of the PowerSync/SQLite sync layer (§5), independent of how the account was created.

This single decision removes the entire bug class that consumed most of the debugging
sessions in your TripSpend history (UID mismatch on migration, "members" stored as two
different shapes, invite generation silently creating an empty shadow trip).

---

## 4. Money is an append-only ledger, not a mutable status field

TripSpend's settlement logic grew into seven separate hand-written transition paths
(pending→paid, paid→completed, creator-fallback overrides for each direction, etc.) because
a payment was modeled as one row whose `status` field got mutated in place. Every new edge
case meant a new path to reason about, and every path was a new place for a permission bug
to hide.

Expensio models money as events, not state:

- `ledger_entries` is **append-only**. An expense being added, edited, or deleted; a payment
  being recorded, confirmed, or disputed — each is a new row, never an edit to an old one.
- A user's balance in a trip is a **derived value** (`sum` over their ledger entries), not a
  stored field anyone writes to directly.
- Corrections are new entries that offset old ones, which doubles as your audit trail for
  free — no separate "settlement history" subcollection to keep in sync.

This is also what makes offline sync tractable: appends never conflict with each other, so
there's no field-level merge logic to write for the money-critical parts of the app. Last-
write-wins (PowerSync's default) is only relevant for genuinely mutable rows like a trip's
`name` or `settings` — never for anything that affects a balance.

See `expensio-data-model.md` for the concrete tables.

---

## 5. Offline sync flow

1. **Read:** UI always reads from local SQLite. Instant, works offline, identical code path
   online or off.
2. **Simple local writes** (draft state, unsent form fields): pure local SQLite, no sync
   needed until submitted.
3. **Sensitive writes** (add expense, join trip, remove member, record payment): the client
   calls the relevant Postgres RPC function through `supabase-js`.
   - **Online:** call succeeds immediately, Postgres applies it, the result flows back down
     through logical replication → PowerSync → local SQLite on every affected device
     (including the caller's, which reconciles any server-computed fields like
     `expense_splits`).
   - **Offline:** the call is queued in a small app-level "pending actions" table (a plain
     local SQLite table, not the PowerSync default queue, since PowerSync's built-in upload
     queue is designed for direct row writes and these are RPC calls). On reconnect, replay
     the queue in order against the RPC functions. Each RPC should be safe to retry
     (idempotency key or a natural check like "already a member" returning success) since a
     retry after a flaky connection is the common case, not the exception.
4. **Conflict handling:** because membership and money both go through RPC functions with
   server-side validation, the server is always the arbiter — a queued "join trip" that
   would exceed the member cap, or hits a revoked invite, simply fails cleanly on replay
   with a message the UI can show, instead of silently corrupting state the way an
   unenforced client-side check would.

---

## 6. FastAPI's job, precisely

FastAPI is a stateless helper service, not a second source of truth. It:

- **Proposes, never writes financial state.** `POST /ocr/receipt` downloads a receipt from
  Supabase Storage, extracts amount/merchant/date, and returns a draft. The client reviews
  it and calls `add_expense` itself. FastAPI never calls `add_expense` on the user's behalf.
- **Reads via a scoped Postgres role**, not the Supabase service-role key, wherever a read
  is all it needs (e.g. `GET /trip/{id}/settlement-plan` reads the `trip_balances` view to
  compute a minimal set of settling transactions).
- **Authenticates by validating the same Supabase JWT** the client already has (via
  Supabase's JWKS endpoint), so "is this user actually a member of this trip" is checked the
  same way it would be by Postgres RLS — no separate auth system to keep in sync.

---

## 7. Folded in from the Splitwise research: notifications, multi-currency, recurring, settlement

**Notifications (push + email).** Every `ledger_entries` and `expense_comments` insert is a
notification-worthy event (new expense, comment, payment recorded/confirmed). Rather than
have the client fire notifications (unreliable — it wouldn't run if the person's phone is
off), a Postgres trigger on those two tables writes a row to a small `notification_events`
queue table; a Supabase Edge Function (invoked via `pg_net` webhook, or polling on a
schedule) reads the queue and fans out to:
  - **Push:** `@capacitor/push-notifications` on the client, backed by Firebase Cloud
    Messaging — the standard pairing for Capacitor apps regardless of backend, since FCM
    handles both Android and iOS delivery.
  - **Email:** a transactional email provider (Resend, Postmark, or similar) — not
    Supabase's built-in auth email, which is only for auth flows.
  - Gated per-user by a `notification_preferences` jsonb column on `profiles`
    (`{"push": true, "email": true, "digest": false}`), checked before sending each channel.

**Multi-currency balances.** Expenses now carry their own `currency` (data model §, updated
per the Splitwise research — a trip can mix currencies). `trip_balances` is per-currency, so
a user's balance in a trip reads as "you owe ₹500 and $12," never silently merged. A single
converted total is optional and computed on demand — either client-side with a cached FX
rate, or via a `GET /trip/{id}/balances/converted?to=INR` FastAPI endpoint that fetches a
rate and sums — but it's a display convenience, never what's stored or what RLS/RPCs reason
about.

**Recurring expenses.** `expense_templates` (data model doc) holds the recurrence rule and
`next_run_date`. A daily Supabase Cron job calls a `generate_due_recurring_expenses()`
Postgres function that finds due templates and calls `add_expense` for each — same RPC,
same validation, same ledger entry, so a recurring expense is never a special case
downstream of creation.

**Settlement channel.** Splitwise's PayPal/Venmo/Splitwise-Pay/Tink integrations are
US/EU-specific and each requires its own KYC and compliance work — a heavy lift you almost
certainly don't need for v1. Given the app is targeting India, a **UPI deep link or QR
code** (`upi://pay?pa=<vpa>&am=<amount>&tn=<note>`) is a far lighter equivalent: it needs no
payment-gateway integration or KYC on your end, works with any UPI app the other person
already has installed, and covers the same real need ("let me just pay you now instead of
marking it settled manually"). `record_payment`'s `metadata` column already has room for a
`payment_method` value (`'cash' | 'upi' | 'other'`) and a reference ID — nothing else in the
schema needs to change, and this generalizes to PayPal/Venmo/bank-transfer later if you ever
expand beyond India without touching the ledger design.

**Phone verification.** Splitwise collects a phone number for anti-fraud/recovery via SMS
OTP, used only as *initial* verification, never an ongoing second factor. Expensio goes
further and makes this mandatory for every account, not just offered — the full sign-up and
verification flow, rate limiting, and India SMS-compliance requirements are in their own
document: `expensio-onboarding-auth.md`.

**Public developer API.** Splitwise exposes an OAuth-protected REST API for third-party
integrations. You get most of this for free already — Supabase auto-generates a PostgREST
API over every table (RLS-gated) and every RPC function is callable as a REST endpoint. A
polished, publicly documented, OAuth-scoped version of that is a real v2 feature (rate
limiting, API keys, docs site) — not something to build now, just noting it's cheap to add
later because the groundwork already exists.

---

## 8. Scalability notes (kept brief — this is a consumer app, not a scale problem yet)

- Index `trip_members(user_id)`, `expenses(trip_id)`, `ledger_entries(trip_id, created_at)`,
  and a unique index on `trip_invites(code)`.
- Use Supabase's transaction-mode connection pooler for FastAPI's Postgres connections.
- `trip_balances` can start as a plain view; move to a materialized view with a refresh
  trigger only if a trip's ledger genuinely gets large (thousands of entries) — don't
  pre-optimize this.
- Receipts: store as compressed images, serve via signed URLs, and consider a lifecycle
  policy for archived trips later. Not needed for v1.

---

## 9. Lessons carried forward from TripSpend, mapped directly

| TripSpend bug | Root cause | Expensio's fix |
|---|---|---|
| "Missing or insufficient permissions" on migration | Local user ID never became the Firebase UID | No migration — `user_id` exists before any trip data does, established during mandatory onboarding (§3) |
| `members` stored as UID array in rules but objects in some app code | No single place owned the shape of membership | `trip_members` join table, written only via RPC (§2) |
| "Generate Invite Code" created an empty shadow trip | The local→cloud handoff was patched, not designed | There is no handoff to patch |
| Create rule didn't restrict `members` to creator | Rule written after the fact, not derived from a spec | `create_trip` RPC sets `created_by` server-side from the JWT, not from client input |
| Join had no member cap while create did | Two code paths for "add a member," only one had the check | One RPC (`join_trip_via_code`) is the only way `trip_members` rows are created after trip creation |
| Invite revocation had no rule path at all | Revocation wasn't in the original design | `trip_invites` has `revoked_at` from day one, with a dedicated `revoke_invite` RPC |
| Removing a member didn't revoke real access | "Remove" only touched a display-layer registry | `trip_members.status = 'active'` is the *only* thing RLS checks — and now the only way status changes is a member leaving voluntarily (§9 permissions doc) |
| Seven-path settlement status machine | Payments modeled as mutable state | Append-only `ledger_entries` — see §4 |
