# Expensio Environments & Deployment

Expensio has separate environments so a migration, Auth setting, or PowerSync stream change
cannot silently affect production users. The application code is shared; project resources
and secrets are not.

## Environment matrix

| Environment | Supabase | PowerSync | FastAPI | Mobile configuration |
|---|---|---|---|---|
| Development | Local Supabase or disposable hosted project | Development instance | Local process | `.env` values for development only |
| Staging | Dedicated staging project with non-production Auth/Storage | Dedicated staging instance | Staging service | Internal test build |
| Production | Production project with restricted access | Production instance | Production service | Store/release build |

Each environment has its own Auth users, Storage bucket, database, JWT/JWKS configuration,
PowerSync connection, and FastAPI secrets. No production data is copied into development.
When sanitized fixtures are needed, generate them from the test strategy rather than taking
real phone numbers, receipts, or financial records.

## Database and PowerSync promotion

1. Create and review a migration under `supabase/migrations/`.
2. Add or update pgTAP coverage under `supabase/tests/`.
3. Apply all migrations to a disposable database and run the complete test suite.
4. Apply to staging using the Supabase CLI or the approved SQL pipeline; do not edit an
   already-applied migration. Add a new numbered migration for corrections.
5. Run authenticated staging checks with anonymous and verified sessions, including RLS,
   RPC idempotency, Auth profile creation, and cross-trip isolation.
6. Deploy the matching PowerSync Sync Streams configuration to staging and verify that a
   member joining/leaving changes the local dataset as expected.
7. Promote the exact migration/configuration artifact to production after approval, then
   run the smoke checklist before opening the release to users.

Migrations that add columns or RPC behavior must remain backward-compatible with the mobile
version currently in the store. Destructive schema changes require a separate deprecation
release and a rollback plan.

## Secrets and configuration

The Expo bundle may contain only client-safe values:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_POWERSYNC_URL`
- `EXPO_PUBLIC_FASTAPI_URL`

The following never belong in the app bundle, repository, or `EXPO_PUBLIC_*` variables:

- Supabase service-role keys
- Postgres passwords or pooler credentials
- FastAPI signing/provider secrets
- Expo push credentials
- RevenueCat secret API keys
- SMS/email provider credentials

CI stores environment-specific secrets in its secret manager. Local development uses an
ignored `.env` file copied from `apps/mobile/.env.example`; the checked-in example contains
names and safe placeholders only.

## CI gates

Every change touching database, service, or mobile code runs the relevant checks:

```text
database: apply migrations to disposable Postgres + run pgTAP
service: python -m pytest services/api/tests -q
mobile: npm ci && npm exec -- tsc --noEmit
mobile/native: npx expo export --platform android --output-dir .expo-export
```

The native export is a bundle check, not a substitute for a real Android device/emulator
test. Production releases additionally require a signed native build and manual smoke test.

## FastAPI deployment

FastAPI is stateless and horizontally replaceable. It validates Supabase JWTs against the
environment's JWKS endpoint and reads through a least-privileged database role or scoped
Supabase API access. It never receives the service-role key in a client request and never
writes expenses, payments, membership, or ledger entries.

Staging and production use separate origins, CORS allowlists, rate limits, and observability
destinations. Settlement responses may be cached briefly by `(trip_id, balance_hash,
currency)`; the cache is invalidated by changed balance data and never used to authorize a
request.

## Rollback and incident rules

- Application rollback means redeploying the prior known-good artifact; database rollback
  means applying a forward corrective migration unless the deployment procedure explicitly
  supports a safe reversible operation.
- If a migration succeeds but a smoke check fails, stop promotion, preserve logs and the
  migration version, and disable the affected feature through a server-side flag where one
  exists.
- If a notification provider fails, queue delivery is retried; domain writes continue.
- If PowerSync is unhealthy, the client continues to show its local read model and queues
  sensitive writes, but the UI must communicate pending state rather than claiming server
  success.

## Production smoke checklist

- Anonymous signup creates a `profiles` row.
- A user can create a trip and see it through PowerSync.
- A verified user can generate and use an invite; an anonymous user is rejected server-side.
- A cross-trip read is denied for trips the session does not actively belong to.
- Add/edit/delete expense creates correct splits, ledger corrections, and immutable log rows.
- Offline queued actions replay once after reconnect.
- FastAPI rejects invalid JWTs and returns settlement suggestions only for an active member.
- Push/email queue rows are created once and retry without duplicating messages.
