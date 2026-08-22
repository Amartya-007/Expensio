# Expensio v1 Scope

This document is the release contract for Expensio v1. It replaces the incremental
decisions spread across the architecture documents with one explicit boundary. A task is
not considered part of the release merely because a table or RPC exists; it must have a
usable client flow, server enforcement where applicable, and verification evidence.

## Product promise

Expensio v1 is an Android-first, offline-first shared-expense ledger for trips and ongoing
small-group spending. A person can create a trip, add real or placeholder participants,
record expenses, see the immutable activity history, and settle balances without the
client becoming the source of truth for money or access.

The release optimizes for a trustworthy shared ledger, not for a complete personal-finance
suite. Every feature that can change money, membership, or invite access is validated by a
Supabase RPC. PowerSync provides the local read model and durable offline reads; it does not
replace server-side business rules.

## v1 journeys

### 1. Start privately

- The app creates or restores a Supabase session.
- An anonymous user can create trips and use the complete solo/placeholder workflow.
- A trip supports a currency, optional dates, archive/unarchive, and soft hiding when the
  caller is its only active member.
- The free plan may limit trip creation, but it never limits participation in a shared
  trip.

### 2. Record and correct spending

- An active member records an expense with a description, amount, currency, payer, category,
  and split configuration.
- Server-side split computation writes the per-participant shares using integer minor-unit
  arithmetic and deterministic rounding.
- v1 supports equal, exact, percentage, shares, adjustment, itemized, and reimbursement
  split types. Unsupported shapes are rejected; the client never silently falls back to an
  equal split.
- Active members can edit or soft-delete an expense. Edits create append-only ledger
  corrections; deletion creates an offsetting entry. The activity log and system comment
  trail remain available.

### 3. Collaborate safely

- A verified phone or Google identity is required before generating or using an invite.
- Verification upgrades the existing anonymous user rather than creating a shadow account.
- Invite links and six-digit codes support joining, revocation, and undoing the inviter's
  own recent mistaken join within the documented one-hour window.
- There is deliberately no general force-remove-member operation. A member leaves for
  themselves; the server revokes access through the membership status.
- Placeholder participants can be managed by active members and can later be claimed by a
  verified account using the verified phone identity.

### 4. Understand and settle a trip

- The client shows per-currency balances derived from the append-only ledger.
- FastAPI exposes a read-only, authenticated settlement suggestion endpoint using the
  deterministic largest-debtor/largest-creditor algorithm.
- Recording or confirming a payment remains a Postgres RPC and creates ledger events; a
  settlement suggestion never writes financial state.

### 5. Keep the group informed

- Expense, comment, payment, invite, and membership events can create notification queue
  records.
- Push and email delivery respect each recipient's preferences, are retried safely, and
  never expose phone numbers or unrelated trip data.
- A user can add comments, attach receipt/photos through protected Storage paths, and use
  the shared default categories. Custom categories are a Plus capability but are visible
  to all members of a subscribed trip.

## Release requirements

The following are release gates, not optional polish:

| Area | Required evidence |
|---|---|
| Database | Fresh migration apply, pgTAP coverage for split math/RLS/RPC invariants, and a real Supabase verification pass |
| Money | Expense add/edit/delete, split totals, per-currency balances, payment events, and idempotent replay all verified |
| Access | Active/left/non-member isolation, invite verification gate, placeholder claim security, and immutable activity log verified |
| Offline | Synced reads work after relaunch, sensitive writes are durably queued, replay is ordered and deduplicated, reconnect flush is tested |
| Auth | Secure session persistence, anonymous start, phone OTP or Google upgrade, and same-user identity preservation verified |
| Mobile | TypeScript/native build passes and the critical flows are exercised on an Android device or emulator |
| Compliance | Privacy/terms, data-safety inventory, and India OTP/invite DLT template materials are prepared for review |

## Explicitly deferred

These are intentionally outside the v1 release contract unless a later scope decision
promotes them:

- iOS distribution, Apple Sign-In, and iOS universal-link production work; Android is the
  v1 platform.
- A public OAuth developer API, income tracking, country statistics, and location-based
  analytics.
- Gateway/KYC settlement integrations such as PayPal, Venmo, or in-app UPI collection.
  v1 may generate a UPI deep link, but it does not process the payment.
- Mathematically optimal settlement minimization; the deterministic greedy algorithm is
  sufficient for v1.
- Forced member removal, roles, viewer permissions, or an admin hierarchy.
- A full budget-management product. Trip dates and optional settings may exist, but daily
  budget dashboards remain deferred until their schema and product semantics are approved.
- Automatic guest-data cleanup policy beyond the documented retention decision.

## Status rule

`TASKS.md` remains the operational checklist. This scope document describes the target;
the checklist records current implementation status. A feature moves to `[x]` only when
the release evidence above exists, not when its RPC, table, or placeholder screen merely
exists.
