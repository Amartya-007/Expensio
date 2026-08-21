# Expensio Testing Strategy

The money and access rules live in Postgres, so TypeScript compilation and client smoke
tests are necessary but insufficient. Expensio uses a layered test strategy with pgTAP as
the minimum database gate, pure Python tests for algorithms, and device checks for native
behavior and visual layout.

## Test layers

### Database: pgTAP

The database suite is authoritative for:

- migration apply order and required tables, indexes, functions, triggers, and publications;
- RLS isolation for active members, left members, non-members, and cross-trip access;
- RPC validation, permissions, idempotency replay, and activity-log atomicity;
- exact split totals in integer minor units for all seven split types;
- placeholder phone uniqueness and verified-JWT claim behavior;
- append-only ledger behavior and edit/delete corrections;
- trip archive/hide and membership join/leave/rejoin history;
- notification queue deduplication and preference defaults once that migration exists.

Tests must run with authenticated fixtures that exercise the same `auth.uid()` and JWT
claims as Supabase. A superuser-only result is not evidence for an RLS requirement. The
fixture setup creates separate users, profiles, trips, members, and participants, then runs
each assertion in a role/session that mirrors the user being tested.

### FastAPI: pytest

Pure settlement math is tested without a database or network. Endpoint tests cover JWT
validation, active-trip authorization, per-currency isolation, stable ordering, and the
absence of write calls. OCR/category suggestions get their own contract tests when added;
provider calls are replaced with deterministic test adapters, not real paid requests.

### Mobile: TypeScript, component tests, native smoke tests

- `npm exec -- tsc --noEmit` catches type and route-contract errors.
- Focused component tests cover serialized split configurations, input validation, RPC
  argument names, retry state, and auth transitions.
- A native Android build/export catches Metro, Babel, OP-SQLite, SecureStore, and Reanimated
  integration issues that TypeScript cannot see.
- A device/emulator smoke pass covers anonymous startup, trip creation, add/edit/delete,
  participant picker, offline queue/replay, auth upgrade, invites, settlement display, and
  deep links.
- Visual UI-port work requires screenshots or a live device review; a passing typecheck is
  never treated as visual verification.

## Required regression cases

Every backend change adds or updates a focused regression for the failure it addresses.
The minimum suite includes:

1. Fresh migrations apply in order.
2. A user cannot read another trip's rows even when sharing a different trip with one of
   its members.
3. Activity-log update/delete is rejected by both RLS and the trigger backstop.
4. Repeating an idempotent RPC returns the original result and creates no duplicate rows.
5. A ₹100 expense split three ways totals exactly ₹100.00 and uses deterministic rounding.
6. Exact, percentage, shares, adjustment, itemized, and reimbursement inputs reject invalid
   totals, unknown participants, and malformed configurations.
7. Editing an expense contributes only the amount delta; deleting it offsets the current
   expense without destroying history.
8. Balances never combine currencies and settlement suggestions never write ledger state.
9. Anonymous invite generation/join is rejected even if the client attempts the RPC directly.
10. A verified user can claim only the placeholder matched to their own verified phone.
11. A queued mobile RPC replays once after reconnect and remains queued on a network failure.

## Commands and evidence

The repository will expose these commands as the test infrastructure is added:

```text
database: supabase test db --local
service: python -m pytest services/api/tests -q
mobile types: cd apps/mobile && npm exec -- tsc --noEmit
mobile bundle: cd apps/mobile && npx expo export --platform android --output-dir .expo-export
```

Each CI job records the command, exit code, test count, and environment. If a required
external environment is unavailable, the task remains `[ ]` or `[~]` with the missing
evidence named in `TASKS.md`; a local substitute is not silently presented as Supabase
verification.

## Test data and security

Fixtures use synthetic UUIDs, names, and phone numbers. Secrets, real receipts, production
JWTs, and real contact lists are prohibited. Test snapshots redact tokens and provider
payloads. Database tests clean up disposable data by resetting the database, not by adding
destructive cleanup logic to production RPCs.
