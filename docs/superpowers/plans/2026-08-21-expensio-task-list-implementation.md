# Expensio Task List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute `TASKS.md` from top to bottom, turning each incomplete Expensio task into a documented, tested, and verifiably working deliverable.

**Architecture:** Keep Supabase Postgres as the source of truth for identity, membership, money, and RPC business rules. Use FastAPI only for authenticated read/proposal workflows such as settlement suggestions and receipt OCR. Keep the Expo/React Native client offline-first, reading synced data locally and sending sensitive writes through RPCs.

**Tech Stack:** Supabase Postgres/RLS/RPCs, pgTAP, PowerSync Sync Streams, FastAPI/Python, Expo SDK 57, React Native, TypeScript, NativeWind, Expo SecureStore, NetInfo.

**Spec:** `TASKS.md` and the architecture documents under `docs/architecture/`.

## Global Constraints

- `TASKS.md` is the source of truth and is updated in the same change as the work it tracks.
- A task is marked `[x]` only after implementation and fresh verification; use `[~]` with an explicit missing-evidence note for partial work.
- Every state-changing money, membership, and invite operation remains server-side in a Postgres RPC.
- Ledger data remains append-only; corrections are new entries and never destructive updates.
- Client reads come from PowerSync SQLite; sensitive client writes use Supabase RPCs and durable offline actions.
- Existing untracked user files and the empty root `.env` deletion are preserved.
- Mobile code changes must be checked against the Expo SDK 57 documentation before implementation.

---

### Task 1: Define and verify Expensio v1 scope

**Files:**
- Create: `docs/architecture/expensio-v1-scope.md`
- Modify: `TASKS.md`
- Test: the scope document's feature matrix against every existing checklist item

**Interfaces:**
- Consumes: existing architecture, data model, onboarding, trip-flow, monetization, and UI-port documents.
- Produces: a single v1 feature matrix naming shipped behavior, required-but-missing behavior, and deliberately deferred behavior.

- [ ] Extract the current implemented, partial, and deferred behavior from `TASKS.md` and the existing architecture documents.
- [ ] Write the v1 document with explicit in-scope user journeys, non-goals, release dependencies, and acceptance evidence for each included feature.
- [ ] Cross-check the document against all `[x]`, `[~]`, and `[ ]` entries and fix contradictions.
- [ ] Run a repository search for stale scope claims and update `TASKS.md` to mark the document complete only after the matrix is internally consistent.

### Task 2: Specify notifications end-to-end

**Files:**
- Create: `docs/architecture/expensio-notifications.md`
- Modify: `TASKS.md`
- Later create: `supabase/migrations/0004_notifications.sql`

**Interfaces:**
- Consumes: `ledger_entries`, `expense_comments`, `profiles`, active membership, and the notification description in `expensio-architecture.md`.
- Produces: event names, recipient rules, templates, preference semantics, delivery retry behavior, and the DDL contract for notification events.

- [ ] Define the event catalog for expenses, comments, payments, invites, membership changes, and system failures.
- [ ] Define recipient filtering, push/email rules, preference defaults, deduplication, retention, and failure/retry semantics.
- [ ] Define the `notification_events` table and `profiles.notification_preferences` shape in the document before writing DDL.
- [ ] Add the migration only after the document contract is complete and add a schema regression test for the table, index, preference default, and RLS.

### Task 3: Specify environments and deployment

**Files:**
- Create: `docs/architecture/expensio-environments-deployment.md`
- Modify: `TASKS.md`

**Interfaces:**
- Consumes: current migrations, PowerSync setup runbook, Expo environment variables, and the planned FastAPI service.
- Produces: dev/staging/prod boundaries, migration promotion procedure, secrets ownership, PowerSync configuration steps, CI checks, rollback rules, and production verification checklist.

- [ ] Document separate Supabase projects and the required Auth, Storage, PowerSync, and FastAPI configuration for each environment.
- [ ] Document migration ordering, immutable migration rules, database backup/rollback expectations, and release gates.
- [ ] Document safe handling of `EXPO_PUBLIC_*`, Supabase service credentials, JWT/JWKS configuration, and FastAPI secrets.
- [ ] Add a checklist that can be executed without assuming local Postgres is equivalent to Supabase Auth.

### Task 4: Establish a testing strategy and runnable database harness

**Files:**
- Create: `docs/architecture/expensio-testing-strategy.md`
- Create: `supabase/tests/0001_core_invariants.sql`
- Create: `supabase/tests/0002_split_math.sql`
- Create: `supabase/tests/0003_rpc_permissions.sql`
- Modify: `TASKS.md`

**Interfaces:**
- Consumes: all migration functions and the requirements in the permissions matrix and data model.
- Produces: pgTAP test entry points covering schema apply, RLS, RPC permissions, idempotency, split math, append-only invariants, and cross-trip isolation.

- [ ] Choose pgTAP as the minimum database test framework and document required auth/profile fixtures.
- [ ] Write failing tests for the highest-risk invariants before changing their SQL implementations.
- [ ] Add a documented command for running the suite against a disposable PostgreSQL/Supabase-compatible database.
- [ ] Keep tests independent of superuser bypasses when validating RLS behavior and record unavailable-environment limitations explicitly.

### Task 5: Correct and verify backend schema/RPC behavior

**Files:**
- Create: `supabase/migrations/0004_notifications.sql` if Task 2 requires it.
- Create: `supabase/migrations/0005_backend_correctness.sql` for corrections after the current migrations.
- Modify: `supabase/tests/*.sql`
- Modify: `docs/architecture/expensio-pre-code-checklist.md`
- Modify: `TASKS.md`

**Interfaces:**
- Consumes: the tests from Task 4 and the existing RPC signatures used by `apps/mobile/src/rpc.ts`.
- Produces: corrected append-only ledger semantics, complete split behavior, secure RPC validation, and migration-safe compatibility for existing callers.

- [ ] Add a failing regression for editing an expense from amount A to amount B and assert that the correction contributes only the delta.
- [ ] Add a failing regression for expense balances using payer and debtor participant identities; resolve the current missing participant linkage before claiming settlement data is correct.
- [ ] Implement the minimal migration-compatible RPC/schema changes and preserve existing public RPC parameter names unless a versioned replacement is required.
- [ ] Implement the adjustment units remainder variant and itemized exact per-person amounts only according to the documented JSON shapes, with validation for unknown participants and totals.
- [ ] Re-run all pgTAP suites and update the checklist with any remaining Supabase-specific gap.

### Task 6: Verify against the real Supabase project

**Files:**
- Modify: `docs/architecture/expensio-environments-deployment.md`
- Modify: `TASKS.md`

**Interfaces:**
- Consumes: real Supabase project access, migrations, Auth/JWKS, PowerSync publication, and the Task 4 test suite.
- Produces: evidence for real Auth-trigger behavior, RLS under authenticated sessions, RPC behavior, and PowerSync publication/sync configuration.

- [ ] Apply migrations in a non-production Supabase project using the documented procedure.
- [ ] Run the equivalent authenticated checks with real anonymous and verified Supabase sessions.
- [ ] Verify PowerSync streams using real JWT/JWKS authentication and membership changes.
- [ ] Keep the task `[ ]` or `[~]` if project access or equivalent evidence is unavailable.

### Task 7: Build the FastAPI service foundation and settlement endpoint

**Files:**
- Create: `services/api/pyproject.toml`
- Create: `services/api/app/main.py`
- Create: `services/api/app/auth.py`
- Create: `services/api/app/settlement.py`
- Create: `services/api/app/models.py`
- Create: `services/api/tests/test_settlement.py`
- Create: `services/api/tests/test_auth.py`
- Create: `services/api/README.md`
- Modify: `docs/architecture/expensio-environments-deployment.md`
- Modify: `TASKS.md`

**Interfaces:**
- Consumes: Supabase JWTs and `trip_balances` read data.
- Produces: `GET /trip/{trip_id}/settlement-plan`, deterministic per-currency suggestions, and authentication/authorization tests.

- [ ] Write failing unit tests for largest-debtor/largest-creditor matching, per-currency isolation, zero balances, and rounding tolerance.
- [ ] Implement the pure settlement algorithm without database or network side effects.
- [ ] Add JWT verification against Supabase JWKS and reject missing, invalid, or unauthorized trip access.
- [ ] Expose the endpoint with typed request/response models and tests proving it never writes financial state.
- [ ] Document the local run command and mark only the implemented FastAPI scope complete; keep OCR explicitly pending until implemented.

### Task 8: Complete mobile auth, secure storage, and real invites

**Files:**
- Read before edits: Expo SDK 57 authentication/security documentation required by `apps/mobile/AGENTS.md`.
- Modify: `apps/mobile/package.json`, `apps/mobile/package-lock.json`
- Modify: `apps/mobile/src/supabaseClient.ts`, `apps/mobile/App.tsx`, `apps/mobile/src/navigation/RootNavigator.tsx`
- Create: `apps/mobile/src/screens/OnboardingScreen.tsx`, `apps/mobile/src/screens/PhoneOtpScreen.tsx`, `apps/mobile/src/screens/JoinTripScreen.tsx`, `apps/mobile/src/screens/InviteScreen.tsx`
- Create: `apps/mobile/src/auth.ts`
- Modify: `TASKS.md`

**Interfaces:**
- Consumes: `is_verified_user`, `generate_invite`, `join_trip_via_code`, and the onboarding flow document.
- Produces: same-user guest upgrade, phone OTP/Google flow, secure session storage, invite generation, join, retry, and error states.

- [ ] Write failing tests for auth state transitions and RPC argument contracts before UI implementation.
- [ ] Replace AsyncStorage session persistence with Expo SecureStore and document fallback behavior for unsupported platforms.
- [ ] Implement guest-to-verified upgrade without losing the existing Supabase user identity.
- [ ] Implement invite and join screens with server-enforced verification handling and deep-link/code entry boundaries.
- [ ] Verify TypeScript, Expo bundling, and manual device behavior before updating task statuses.

### Task 9: Complete mobile financial and membership features

**Files:**
- Modify: `apps/mobile/src/powersync/AppSchema.ts`, `supabase/powersync/sync-streams.yaml`
- Modify/create screens under: `apps/mobile/src/screens/`
- Modify: `apps/mobile/src/navigation/RootNavigator.tsx`, `apps/mobile/src/rpc.ts`
- Modify: `apps/mobile/package.json`, `apps/mobile/package-lock.json`
- Modify: `TASKS.md`

**Interfaces:**
- Consumes: corrected backend RPCs, `ledger_entries`, `custom_categories`, `expense_comments`, `expense_attachments`, and `expense_templates`.
- Produces: non-equal split forms, balances/settlement display, leave trip, categories, comments, attachments, recurring expenses, revoke/undo actions, and reconnect flushing.

- [ ] Add failing tests for each split form’s serialized `split_config` before wiring UI controls.
- [ ] Sync and display ledger/balance data only after backend invariants pass.
- [ ] Add feature screens in task-list order and keep all writes RPC-first with durable retry behavior.
- [ ] Add NetInfo reconnect handling with deduplicated flushes and tests for offline-to-online transitions.
- [ ] Verify native build/typecheck and update only the tasks supported by evidence.

### Task 10: Finish UI port and launch blockers

**Files:**
- Modify/create mobile screens and shared components under `apps/mobile/src/`
- Create: `docs/legal/privacy-policy.md`, `docs/legal/terms-of-service.md`, `docs/legal/data-safety-inventory.md`, `docs/legal/dlt-sms-registration.md`
- Modify: `docs/architecture/expensio-ui-port-plan.md`, `TASKS.md`

**Interfaces:**
- Consumes: v1 scope, secure auth behavior, completed financial flows, and the UI-port plan.
- Produces: verified visual port, privacy/terms language, data-safety inventory, and DLT message templates.

- [ ] Complete each unblocked UI-port row and keep budget-dependent rows deferred until product/schema decisions are implemented.
- [ ] Capture device screenshots or a runnable native build for visual verification; do not treat TypeScript compilation as visual proof.
- [ ] Draft legal and compliance artifacts from the actual data flows, with explicit review-required language where legal counsel is needed.
- [ ] Perform a final requirement-by-requirement audit of `TASKS.md`, the docs, migrations, service, and mobile app before marking the overall goal complete.

