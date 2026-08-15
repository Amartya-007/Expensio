# Expensio — Pre-Code Checklist

Where things stand across the seven docs in `docs/architecture/`, and what's still worth
resolving before writing feature code against them. Superseded parts of the original version
of this doc (written before the split-rounding rule, settlement algorithm, and activity log
were specified) are corrected below rather than left contradicting the other docs.

## What's solid

Architecture, data model, permissions/RLS/RPCs, onboarding/auth, trip-creation/invite flow,
and monetization are all pushed and internally consistent — no known contradictions between
them. The schema and RPCs described in those docs are now real, applied migrations
(`supabase/migrations/0002_core_schema.sql`, `0003_rls_and_rpcs.sql`), not just prose — see
below for what that transcription work actually found and fixed.

- `compute_expense_splits` and the settlement-plan debt-simplification algorithm are fully
  specified (data model doc), and `compute_expense_splits` now has a real, tested
  implementation in `0003_rls_and_rpcs.sql` — it was referenced by name throughout the RPCs
  but never actually given a body until now.
- Solo trip minimum, email invites, iOS scope (Android-first, deferred), default currency
  list (11), and default category list (9) are all resolved (trip-creation-flow doc).
- The immutable per-trip activity log (`trip_activity_log`) shipped, DB-enforced via two
  independent layers (confirmed separately in local testing): RLS has no UPDATE/DELETE
  policy on that table at all, so a client-side mutation attempt touches zero rows before
  a trigger ever runs; the trigger itself is the backstop for anything that bypasses RLS
  (a superuser, a future SECURITY DEFINER function). Plus: idempotency keys on every write
  RPC (now genuinely fixed — see below), the placeholder-claim security fix, and
  `delete_trip` changed to soft-hide so it can't destroy its own log.

**Found and fixed while turning the docs into real migrations, verified against a local
Postgres instance (fresh apply, 11 test scenarios covering every RPC category, not just a
syntax check):**
- `trip_members` referenced `trip_invites.id` before `trip_invites` was defined — a forward
  reference that fails on a fresh apply. Reordered.
- Every idempotent RPC returning an id/code returned `null` on a replayed call instead of
  the original result, even though several callers need it back
  (`create_trip`'s own comment claimed "client already has the trip_id," which isn't
  true — ids are server-generated). `processed_requests` now has a `result jsonb` column;
  `claim_idempotency_key_with_result` stores and replays the real result.
- Two placeholders in the same trip could end up with the same phone number (nothing
  prevented it), which made `join_trip_via_code`'s claim-by-phone `UPDATE` match both rows
  at once — Postgres doesn't error on a multi-row `RETURNING ... INTO`, so both placeholders
  silently got claimed by the same joining user, which then hit the *other* unique
  constraint with a confusing error. Added a partial unique index on
  `participants(trip_id, phone)` for placeholders, so the bad state can't occur in the
  first place; `add_placeholder_participant` now raises a clear error instead of a
  constraint-violation message if it's attempted.

That's a real, tested foundation, not just a pile of documents.

## Real gaps — things referenced by name but never actually specified

- **Notifications.** Architecture doc §7 describes the *shape* (Postgres trigger → queue →
  Edge Function → push/email) but there's still no `notification_events` table in the actual
  DDL, no event-to-template mapping, and `profiles.notification_preferences` is referenced in
  prose but was never added as a column. This is the one remaining gap between "described"
  and "specified" — doesn't block scaffolding, blocks the notifications feature specifically.
- **`compute_expense_splits`'s two narrower gaps**, left as explicit judgment calls in the
  migration's comments rather than silently guessed: the `adjustment` split type's
  "remainder split... by units, per split_config" variant isn't implemented (only the equal
  remainder is); `itemized` items with their own exact per-person amounts aren't handled
  (only equal shared_by splitting per item, matching the doc's shown `split_config` shape).
  Add either if a real expense actually needs it.

## New docs worth writing before code, not yet written

1. **A v1 scope doc** — still the most valuable one missing. Every decision so far has been
   made incrementally; there's no single page saying "this is what Expensio v1 actually does"
   versus what's deliberately deferred.
2. **A notifications doc** — same treatment `expensio-onboarding-auth.md` and
   `expensio-trip-creation-flow.md` already got: schema, event catalog, push vs. email rules,
   template content.
3. **An environments & deployment doc** — dev/staging/prod Supabase projects, migration
   tooling (Supabase CLI migrations vs. hand-applied SQL), where FastAPI runs, CI/CD. Worth
   having before the first real deploy, not before the first line of code.
4. **A testing strategy** — real business logic lives in ~20 Postgres RPCs; worth deciding
   the approach (pgTAP for the RPCs, at minimum) before they're written, not bolted on after.

## Still genuinely open, not yet decided

- **Apple Sign-In** — moot while Android-first, but required by App Store review the moment
  iOS ships (onboarding doc §10).
- **Username: unique handle or just a display name?** Assumed display-name-only; flag if
  unique handles are wanted instead (onboarding doc §10).
- **App lock: opt-in or forced?** Currently off-by-default (onboarding doc §10).
- **Guest data retention** — whether an inactive guest's solo trip is ever purged or kept
  indefinitely (onboarding doc §10).
- **Free-trial cap (3) and price (₹2,200/year)** are placeholders, not a business decision
  (monetization doc §7).
- **What happens to a trip's paid features when the subscribed member leaves it?**
  Recommendation given (stay visible read-only, can't add new) but not confirmed
  (monetization doc §7).

None of these block scaffolding — each blocks a specific feature or launch step, not the
skeleton.

## Not blocking code, but needed before a real launch

- **Privacy Policy + Terms of Service** — the data model already tells you exactly what they
  need to cover: phone numbers, contacts data, financial records, account-deletion/
  pseudonymization behavior.
- **App store data-safety disclosures** (Play's Data Safety form, Apple's App Privacy
  "nutrition label").
- **DLT SMS template registration** — needed for both the OTP template and the separate
  "you've been invited to a trip" template (trip-creation-flow doc §3).

## PowerSync — the highest-risk unknown in the whole stack

Still alpha/beta as of when this was checked. Should be the *literal first thing built* — a
tiny spike syncing one dummy table through the full path (Postgres → PowerSync → local SQLite
on a real device) — before any real feature code sits on top of it. Cheap to discover a
problem on day one; expensive to discover it on day sixty.
